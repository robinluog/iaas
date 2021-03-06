require("babel-polyfill");

import fs from "fs";
import gm from "gm";
import log from "./log";
import uuid from "uuid";

const im = gm.subClass({imageMagick: true});

// 10 seconds
const clearTempfilesTimeout = 10000;

// Wrap these calls in promises so we can use async/await
const write = (client, file) => {
  return new Promise((resolve, reject) => client.write(file, err => err ? reject(err) : resolve()));
};
const size = (client) => {
  return new Promise((resolve, reject) => client.size((err, data) => err ? reject(err) : resolve(data)));
};

// Interlacing for png isn't efficient (both in filesize as render performance), so we only do it for jpg
const interlace = async(client, params) => {
  if (params.mime === 'image/jpeg') {
    return client.interlace('Line');
  }
  return client;
};

// When cropping, we size the image first to fix completely within the bounding box
// Then we crop the requested size, and center to the center of the image
const crop = async(client, params) => {
  // Resize the image to fit within the bounding box
  // The ^ ensures the images is resized while maintaining the ratio
  // However the sizes are treated as minimum values instead of maximum values
  client = client.resize(params.width, params.height, '^');
  const tmpFile = `/tmp/${uuid.v4()}`;
  try {
    await write(client, tmpFile);
    client = im(tmpFile);
    const imgSize = await size(client);
    setTimeout(() => fs.unlink(tmpFile), clearTempfilesTimeout);
    return client
      .repage(imgSize.width, imgSize.height, 0, 0)
      .gravity('Center')
      // Crop the image to the exact size (the ! indicates a force)
      // This is ok since we first resized appropriately
      .crop(params.width, params.height, '!');
  } catch (e) {
    log('error', 'could not write tempfile');
    log('error', e.stack);
    throw e;
  }
};

// The sizes in the params given define the bounding box. The image is sized
// proportionally such that it fits in the bounding box without cropping
const clip = async(client, params) => {
  return client.resize(params.width, params.height);
};

// Same as clipping, however the remainder of the bounding box is filled with
// white.
const canvas = async(client, params) => {
  client = await clip(client, params);
  return client.gravity('Center').extent(params.height, params.width);
};

// Fit the image appropriately.
const fit = async(client, params) => {
  if (params.fit === 'crop') {
    return crop(client, params);
  } else if (params.fit === 'canvas') {
    return canvas(client, params);
  } else if (params.fit === 'clip') {
    return clip(client, params);
  }
  throw new Error(`Format '${params.fit}' was accepted but could not be handled`);
};

// Blur the image if requested in the params
const blur = async(client, params) => {
  if (params.blur === null) {
    return client;
  }
  return client.blur(params.blur.radius, params.blur.sigma);
};

export default {
  magic: async function (file, params) {
    let client = im(file);
    client = await interlace(client, params);
    client = await fit(client, params);
    client = await blur(client, params);
    return client;
  },
  writeOriented: async function (source, destination, cropParameters) {
    // if possible, crop first (since the UA had that orientation), then orient
    if (cropParameters) {
      const cropped = im(source).crop(cropParameters.width, cropParameters.height, cropParameters.xOffset, cropParameters.yOffset);
      await write(cropped, source);
    }

    const oriented = im(source).autoOrient();

    try {
      await write(oriented, destination);
    } catch (e) {
      log('error', e.stack);
      throw e;
    }

    try {
      const imgSize = await size(im(destination));
      return {
        originalHeight: imgSize.height || null,
        originalWidth: imgSize.width || null
      };
    } catch (e) {
      log('error', e.stack);
      return {
        originalHeight: null,
        originalWidth: null
      };
    }
  }
};
