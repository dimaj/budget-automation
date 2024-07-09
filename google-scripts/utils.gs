var userProperties = PropertiesService.getScriptProperties();

/**
 * Get a value associated with a property
 * @param propName {string} Name of the property to get
 * @returns {string} Value of the property
 */
function getPropertyValue(propName) {
  return userProperties.getProperty(propName);
}

// Function to find objects in an array of objects by key value
function findObjectByKey(array, key, value) {
  for (var i = 0; i < array.length; i++) {
    if (array[i][key] === value) {
      return array[i];
    }
  }
  return null;
}

function getDateString(dateMath, timeZone, dateFormat) {
  const date = new Date();
  if (dateMath) {
    date.setDate(date.getDate() + dateMath);
  }
  if (!timeZone) {
    console.log("timeZone was not specified. defaulting to 'UTC'");
    timeZone = "UTC";
  }
  
  return Utilities.formatDate(date, timeZone, dateFormat);
}
// // get yesterday in YYYY-MM-dd
// function isWeekday() {
//   console.log("starting");
//   var date = new Date();
//   console.log("Date is:", date);
//   date.setDate(date.getDate() - 1);
//   console.log("new date is:", date);
//   var curDay = parseInt(Utilities.formatDate(new Date(), "PST", "YYYY-MM-dd"));
//   var fmt = Utilities.formatDate(date, "PST", "YYYY-MM-dd");
//   return curDay <= 5;  
// }

/**
 * Checks whether today is a weekday
 * @return {boolean} True if today is a weekday; False otherwise
 */
function isWeekday() {
  var curDay = parseInt(Utilities.formatDate(new Date(), "EST", "u"));
  return curDay <= 5;  
}


/**
 * Extracts a match at an index
 * @param match {string[]} List of matches
 * @param index {number} Index at which match should be extracted
 * @returns {string} Requested field or undefined is not found
 */
function getValueFromMatchAtIndex(match, index) {
  if (match && match.length > index) {
    const rv = match[index];
    return rv.length >= 100 ? rv.substring(0, 100) : rv;
  }
}

/**
 * Parses amount from string to float.
 * @param amountStr {string} Amount to parse.
 * @returns {number} Parsed amount.
 * @example `parseAmount("1,234.56"); // returns 1234.56`
 */
function parseAmount(amountStr) {
  if (!amountStr) return undefined;
  return parseFloat(amountStr.replace(',', ''));
}

/**
 * Checks if object is 'null' or 'undefined'
 * @param value {any} Value to check if it is null or undefined
 * @returns {boolean} True if object is null or undefined
 * @example `IsNullOrUndefined(null); // returns true
 */
function IsNullOrUndefined(value) {
  return value === undefined || value === null;
}