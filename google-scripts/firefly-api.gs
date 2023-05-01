const apiParts = {
  headers: {
    Authorization: `Bearer ${getPropertyValue('firefly-pat')}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.api+json'
  },
  endpoint: `${getPropertyValue('firefly-endpoint')}/api/v1`
}

/**
 * Submit transaction to Firefly server
 * @param transaction {Object} Transaction to submit
 * @returns {boolean} True if transaction was added; False otherwise
 */
function addFireflyTransaction(transaction) {
  const url = `${apiParts.endpoint}/transactions`;
  var options = {
    method: 'POST',
    payload: JSON.stringify(transaction),
    headers: apiParts.headers,
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(url, options);
  const retVal = Math.round(response.getResponseCode() / 100) === 2
  if (!retVal) {
    console.log(response.getContentText());
  }

  return retVal;
}
