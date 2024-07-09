const actualProcessor = {
  baseUrl: getPropertyValue('actualApiEndpoint'),
  budgetSyncId: getPropertyValue('actualBudgetId'),
  fetchOptions: {
    headers: {
      'x-api-key': getPropertyValue('actualApiKey'),
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    method: 'GET'
  },
  /**
   * Adds transaction to register
   * @param transaction {object} Transaction to record
   * @return The HTTP response data
   */
  addTransaction: ({
    accountId, 
    amount, 
    payeeName, 
    cleared = false, 
    notes = 'Entered automatically by Google Apps Script automation #to-process',
    } = transaction
  ) => {
    const payload = {
      transaction: {
        account: accountId,
        notes,
        amount: parseInt(amount * 100),
        payee_name: payeeName,
        date: Utilities.formatDate(new Date(), "PST", "yyyy-MM-dd"),
        cleared
      }
    };

    const options = {
      ...actualProcessor.fetchOptions,
      method: 'POST',
      payload: JSON.stringify(payload)
    }
    const endpoint = `${actualProcessor.baseUrl}/v1/budgets/${actualProcessor.budgetSyncId}/accounts/${accountId}/transactions`;

    return UrlFetchApp.fetch(endpoint, options);
  },
  /**
   * Processes transaction for ActualBudget
   * @return HTTP Response data for entering transaction into register
   */
  processTransaction: ({ actual: { account }, merchant, amount, notes, category, cleared = false }) => {
    const transaction = {
      accountId: account,
      amount,
      payeeName: merchant,
      cleared,
      notes,
      category
    };

    Logger.log(`About to submit ActualBudget transaction for '${merchant}' in the amount of '${amount}'`);

    const res = actualProcessor.addTransaction(transaction);
    return Math.round(res.getResponseCode() / 100) === 2;
  },

  getAccountValue: accountName => {
    const account = actualProcessor.getAccount(accountName);
    const endpoint = `${actualProcessor.baseUrl}/v1/budgets/${actualProcessor.budgetSyncId}/accounts/${account.id}/balance`
    return JSON.parse(UrlFetchApp.fetch(endpoint, actualProcessor.fetchOptions)).data / 100;
  },

  getTransactions: ({ accountId, since }) => {
    let sinceParam = since && since || '1970-01-01';
    const endpoint = `${actualProcessor.baseUrl}/v1/budgets/${actualProcessor.budgetSyncId}/accounts/${accountId}/transactions?since_date=${sinceParam}`;
    const response = UrlFetchApp.fetch(endpoint, actualProcessor.fetchOptions);
    if (Math.round(response.getResponseCode() / 100) !== 2) {
      Logger.log(`Failed to fetch Actual transactions due to ${response.getContentText()}`);
      return null;
    }
    return JSON.parse(response).data;
  },

  updateTransactions: (transactions) => {
    if (IsNullOrUndefined(transactions) || transactions.length === 0) {
      Logger.log('There are no transactions to update.');
      return true;
    }

    const endpoint = `${actualProcessor.baseUrl}/v1/budgets/${actualProcessor.budgetSyncId}/transactions`;
    const requests = transactions
      .map(transaction => ({
        ...actualProcessor.fetchOptions,
        method: 'PATCH',
        payload: JSON.stringify({ transaction }),
        url: `${endpoint}/${transaction.id}`
      }));

      return UrlFetchApp.fetchAll(requests);
  },

  updateTransactionMemoForAmazon: (transaction, regex) => {
    if (IsNullOrUndefined(transaction.notes)) {
      return null;
    }
    
    const amazonTransactionId = transaction.notes.match(regex);
    if (!amazonTransactionId) {
      return null;
    }

    return {
      ...transaction,
      notes: transaction.notes.replace(amazonTransactionId[0], `[${amazonTransactionId[0]}](${amazonOrderBaseUrl}${amazonTransactionId[0]})`)
    };
  },

  /**
   * Get account information based on account name
   * @param {string} accountName Name of the account to find
   * @return {BudgetAutomation.ActualAccount}
   */
  getAccount (accountName) {
    const endpoint = `${actualProcessor.baseUrl}/v1/budgets/${actualProcessor.budgetSyncId}/accounts`;
    const response = UrlFetchApp.fetch(endpoint, actualProcessor.fetchOptions);
    if (Math.round(response.getResponseCode() / 100) !== 2) {
      Logger.log(`Failed to fetch account account details for account '${accountName}'`);
      return null;
    }

    return JSON.parse(response)
      .data
      .find(account => account.name === accountName);
  }

}
