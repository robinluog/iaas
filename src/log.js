// Central logging. console.log can be replaced by writing to a logfile for example
export default (level, message) => {
  const obj = {
    datetime: Date.now(),
    severity: level,
    message: message
  };
  console.log(JSON.stringify(obj));  //eslint-disable-line no-console
};
