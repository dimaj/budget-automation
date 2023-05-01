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
// get yesterday in YYYY-MM-dd
function isWeekday() {
  console.log("starting");
  var date = new Date();
  console.log("Date is:", date);
  date.setDate(date.getDate() - 1);
  console.log("new date is:", date);
  var curDay = parseInt(Utilities.formatDate(new Date(), "PST", "YYYY-MM-dd"));
  var fmt = Utilities.formatDate(date, "PST", "YYYY-MM-dd");
  return curDay <= 5;  
}
