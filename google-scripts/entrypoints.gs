/**
 * Updates Amazon transaction comments to convert order numbers to links
 */
function updateAmazonTransactionComments() {
  const fiveDaysMillis = 5 * 24 * 3600 * 1000;
  const since = getDateString(-1 * fiveDaysMillis , "PST", "YYYY-MM-dd");

  const accounts = ['chase_amazon', 'amazon_gc']
    .map(accountName => getProviderConfigs(accountName));

  // iterate over all enabled providers
  const providers = Object.values(budgetProviders)
    // filter out those providers that are disabled and does not have 'getTransactions' method
    .filter(provider => provider.enabled 
                        && provider.api.hasOwnProperty('getTransactions')
                        && provider.api.hasOwnProperty('updateTransactions')
                        && provider.api.hasOwnProperty('updateTransactionMemoForAmazon')
    )
    .map(provider => ({ provider, transactions: accounts.map(account => account[provider.name].account)
      .flatMap(accountId => provider.api.getTransactions({ since, accountId }))
    }))
    .map(results => {
      // filter out transactions
      const transactions = results.transactions
        .map(transaction => results.provider.api.updateTransactionMemoForAmazon(transaction, /^\s*(\d{3,7}-?){3}/))
        .filter(transaction => !IsNullOrUndefined(transaction))

      // if there are no transactions to update, exit out
      if (transactions.length === 0) return true;

      Logger.log(`About to update ${transactions.length} transactions for ${results.provider.name}`);
      const responses = results.provider.api.updateTransactions(transactions);
      const rv = responses
        .map(response => Math.round(response.getResponseCode() / 100) === 2)
        .reduce((res, cur) => res && cur, true);
      if (!rv) {
        Logger.log(`Failed to update transaction(s)`);
      }
    });
}

function budgetAutomation() {
  // update labels
  emailLabler();
  
  // get all pending labels
  const pendingLabels = Object.keys(budgetProviders)
    .filter(provider => budgetProviders[provider].enabled)
    .flatMap(provider => Object.keys(budgetProviders[provider].labels)
      .filter(label => label.toLowerCase().indexOf('pending') >= 0)
      .map(label => ({ [label]: budgetProviders[provider].labels[label]}))
    )
    .reduce((res, cur) => ({ ...res, ...cur }));

  // make sure that there are some 'pending' labels
  if (Object.keys(pendingLabels).length === 0) {
    Logger.log('Could not find any pending labels. Aborting.');
    return;
  }

  const pendingThreads = Object.keys(pendingLabels)
    .map(label => ({label, threads: pendingLabels[label].getThreads()}))
    .map(({label, threads}) => threads.map(thread => ({
      email: thread,
      type: label === 'pending' ? emailType.CREDIT_CARD : emailType.ORDER,
      labelToRemove: pendingLabels[label]
    })))
    .reduce((res, cur) => [...res, ...cur], []);

  pendingThreads.forEach(({email, type, labelToRemove}) => {
    const messageFieldArr = email.getMessages()
      .flatMap(message => extractFieldsFromMessage(message, type))
      .filter(f => f && !IsNullOrUndefined(f.amount));


    // process all providers
    const result = Object.keys(budgetProviders)
      .map(provider => processEmail(email, messageFieldArr, budgetProviders[provider], type))
      .reduce((res, cur) => res && cur, true);
    if (result) {
      email
        .removeLabel(labelToRemove)
        .moveToArchive();
    }
  });
}

/**
 * Adds proper labels to emails that have been automatically
 * categorized and therefore not labled by gmail automation
 * @return {void}
 */
function emailLabler() {
  const labelerConfig = {
    transactions: {
      emailList: [
        'no.reply.alerts@chase.com',
        'alerts@info6.citi.com',
        'alerts@notify.wellsfargo.com',
        'discover@services.discover.com'
      ].join(' OR '),
      labelToAdd: globalLabels.pending,
      searchString: `Merchant -{"You've reached your pre-set balance"}`
    },
    orders: {
      emailList: [
        'auto-confirm@amazon.com'
      ].join(' OR '),
      labelToAdd: globalLabels.ordersPending,
      searchString: `subject:("Your Amazon.com order" OR "Your refund") ("Order Confirmation" OR "Refund Confirmation")`
    }
  };

  const labelsToExclude = Object.keys(budgetProviders)
    .flatMap(provider => Object.values(budgetProviders[provider].labels))
    .map(label => `-label:${label.getName().replace(' ', '-').replace('/', '-')}`)
    .reduce((res, cur) => res.includes(cur) ? res : [...res, cur], [])
    .join(' ');

  Object.keys(labelerConfig)
    .forEach(config => 
      GmailApp
        .search(`${labelsToExclude} from:( ${labelerConfig[config].emailList} ) ${labelerConfig[config].searchString}`)
        .forEach(thread => {
          Logger.log(`About to add label to thread: ${thread.getMessages()[0].getSubject()}`);
          thread.addLabel(labelerConfig[config].labelToAdd);
        })
    );
}

/**
 * Performs the end of the month cleanup
 */
function endOfMonthCleanup() {
  Object.values(budgetProviders)
    // filter out those providers that are disabled and does not have 'cleanup' method
    .filter(provider => provider.enabled && provider.api.hasOwnProperty('cleanup'))
    .forEach(provider => {
      provider.api.cleanup()
    });
}

/**
 * Performs the end of the month cleanup
 */
function automaticSavingsPlan() {
  Object.values(budgetProviders)
    // filter out those providers that are disabled and does not have 'cleanup' method
    .filter(provider => provider.enabled && provider.api.hasOwnProperty('automaticSavingsPlan'))
    .forEach(provider => {
      provider.api.automaticSavingsPlan()
    });
}

/**
 * Updates account with current stock account value
 */
function updateStocks() {
  const providers = Object.keys(budgetProviders)
    .filter(provider => budgetProviders[provider].enabled)
    .map(provider => budgetProviders[provider]);

  providers.forEach(provider => {
    const accounts = stocksProcessor.getInvestmentAccounts(provider);
    accounts.forEach(account => {
      const accountName = (typeof account === 'string') ? account : account.name;
      const curValue = provider.api.getAccountValue(accountName);
      const portfolioValue = stocksProcessor.getPortfolioValue(provider, accountName);
      const diff = Math.round((portfolioValue - curValue) * 100) / 100;
      Logger.log(`total: ${portfolioValue}`);

      if (Math.abs(diff) >= 1) {
        console.log(`About to add a transaction for $${diff}`);
        const transaction = {
          [provider.name]: accountName,
          account_id: account.id,
          amount: diff,
          merchant: 'Fidelity',
          notes: "Daily Account Balance Update",
          cleared: true
        };
        provider.api.processTransaction(transaction);

      } else {
        console.log(`Amount is '$${diff}'. No need to enter a new transaction.`);
      }
    });
  });
}
