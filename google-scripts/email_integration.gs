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

const ynabAccountProperty = JSON.parse(getPropertyValue('ynabEmailAutomationAccounts') || '{}');
const fireflyAccountProperty = JSON.parse(getPropertyValue('fireflyEmailAutomationAccounts') || '{}');

const emailLabels = {
  pending: 'Budget Automation/budget-to-process',
  ynabDone: 'Budget Automation/ynab-processed',
  fireflyDone: 'Budget Automation/firefly-processed',
  ordersPending: 'Budget Automation/transactions-to-process',
  ordersYnabDone: 'Budget Automation/transactions-ynab-processed',
  ordersFireflyDone: 'Budget Automation/transactions-firefly-processed'
};

const pending = getLabelOrCreate(emailLabels.pending, false);
const ynabDone = getLabelOrCreate(emailLabels.ynabDone, true);
const fireflyDone = getLabelOrCreate(emailLabels.fireflyDone, true);

const labels = Object.keys(emailLabels).reduce((res, cur) => {
  // if label has 'pending' in it, do not create it
  const shouldCreate = cur.match(/pending/i) === null;
  const label = getLabelOrCreate(emailLabels[cur], shouldCreate);
  return { ...res, [cur]: label };
}, {});

/**
 * Map of available accounts.
 */
const accountsMap = {
  chase: {
    match: (from) => from.indexOf('chase') >= 0,
    fields: (body) => {
      const accountMatch = body.match(/Account<\/td>(.|\s)+?>((.|\s)+?)</m);
      const merchantMatch = body.match(/Merchant<\/td>(.|\s)+?>((.|\s)+?)</m);
      const amountMatch = body.match(/Amount<\/td>(.|\s)+?>\$((.|\s)+?)</m);
      const account = getValueFromMatchAtIndex(accountMatch, 2);
      let merchant = getValueFromMatchAtIndex(merchantMatch, 2);
      let amount = parseAmount(getValueFromMatchAtIndex(amountMatch, 2));
      if (body.indexOf('You made') >= 0 && body.indexOf('transaction') >= 0) {
        amount *= -1;
      }

      if (merchant && merchant.indexOf('AMZN') >= 0) {
        merchant = 'Amazon';
      }
      const budgets = (account && account.indexOf('4303') >= 0)
        ? {
            ynab: ynabAccountProperty.chase_freedom,
            firefly: fireflyAccountProperty.chase_freedom
          }
        : (account && account.indexOf('2953') >= 0)
          ? {
              ynab: ynabAccountProperty.chase_amazon,
              firefly: fireflyAccountProperty.chase_amazon
            }
          : undefined;
      return { ...budgets, merchant, amount };
    }
  },
  citi: {
    match: (from) => from.indexOf('citi') >= 0,
    fields: (body) => {
      const merchant = getValueFromMatchAtIndex(body.match(/Merchant<\/span>(.|\s)+?>\b((.|\s)*?)<\/span/m), 2);
      let amount;
      if (body.indexOf('payment posted') > 0 || body.indexOf('credit posted') >= 0) {
        amount = parseAmount(getValueFromMatchAtIndex(body.match(/A\s*\$(.+?)\s/m), 1));
      } else {
        amount = -1 * parseAmount(getValueFromMatchAtIndex(body.match(/Amount(.|\s)+?\$(.|\s)*?([\d\,\.]*)</m), 3));
      }

      const ynab = ynabAccountProperty.citi;
      const firefly = fireflyAccountProperty.citi;

      return { ynab, firefly, merchant, amount }
    }
  },
  wellsfargo: {
    match: (from) => from.indexOf('notify.wellsfargo.com') >= 0,
    fields: (body) => {
      if (body.indexOf("You've reached your pre-set balance") >= 0) {
        return undefined;
      }

      const merchantAmountMatch = body.match(/Withdrawals(.|\s)+?>\b((.|\s)+?)<(.|\s)*?\$([\d\,\.]*)</m);
      Logger.log(`matches are: ${merchantAmountMatch}`);
      let amount = 0; // TODO add regex for deposits
      if (body.indexOf('Withdrawals') >= 0) {
        amount = -1 * parseAmount(getValueFromMatchAtIndex(merchantAmountMatch, 5));
      } else {
        amount = parseAmount(getValueFromMatchAtIndex(merchantAmountMatch, 5));
      }
      const merchant = getValueFromMatchAtIndex(merchantAmountMatch, 2);
      const ynab = ynabAccountProperty.wellsfargo;
      const firefly = fireflyAccountProperty.wellsfargo;
      return { ynab, firefly, merchant, amount };
    }
  },
  discover: {
    match: from => from.indexOf('discover.com') >= 0,
    fields: body => {
      const merchantMatch = body.match(/Merchant:\s*(.+?)</m);
      const amountMatch = body.match(/Amount:\s*\$(.+?)</m);
      let merchant = getValueFromMatchAtIndex(merchantMatch, 1);
      const amount = parseAmount(getValueFromMatchAtIndex(amountMatch, 1));
      const ynab = ynabAccountProperty.discover;
      const firefly = fireflyAccountProperty.discover;

      return { ynab, firefly, merchant, amount };
    }
  }
}

/**
 * Map of merchants to process
 */
const merchantEmailsMap = {
  amazon: {
    match: (from) => from.indexOf('auto-confirm@amazon.com') >= 0,
    fields: (body) => {
      const test = body.match(/Order Total:.+?\$([\d\.]*)/s);
      const orderNumber = getValueFromMatchAtIndex(body.match(/Order <a href.+?>\#(.*?)</s), 1);
      const amount = -1 * parseAmount(getValueFromMatchAtIndex(body.match(/Order Total:.+?\$([\d\.]*)/s), 1));
      return {
        merchant: 'Amazon',
        notes: orderNumber,
        category: null,
        amount,
        ynab: ynabAccountProperty.chase_amazon
      };
    }
  }
}
const ynabBudget = getBudget(getPropertyValue('ynabBudgetName'));

/**
 * Gets reference to an email label
 * @param labelName {string} Label to get
 * @param shouldCreate {boolean} Should label be created if it doesn't exist
 * @returns {GmailApp.GmailLabel} Reference to a label
 */
function getLabelOrCreate(labelName, shouldCreate) {
  const rv = GmailApp.getUserLabelByName(labelName);
  if (!rv && shouldCreate) {
    rv = GmailApp.createLabel(labelName);
  }

  return rv;
}


const budgetTypes = {
  YNAB: { name: 'ynab', enabled: true, ordersLabelToAdd: labels.ordersYnabDone, transactionLabelToAdd: labels.ynabDone, functToRun: processYnab },
  FIREFLY: { name: 'firefly', enabled: false, ordersLabelToAdd: labels.ordersFireflyDone, transactionLabelToAdd: labels.fireflyDone, functToRun: processFirefly }
};



function budgetAutomation() {
  if (!labels.pending && !labels.ordersPending) {
    Logger.log(`Could not find '${emailLabels.pending}' or '${emailLabels.ordersPending}' labels. Abourting.`);
    return;
  }

  const pendingThreads = [
    ...labels.pending.getThreads().map(t => ({ email: t, type: 'CreditCard', labelToRemove: labels.pending })),
    ...labels.ordersPending.getThreads().map(t => ({ email: t, type: 'Orders', labelToRemove: labels.ordersPending }))
  ];

  pendingThreads.forEach(({email, type, labelToRemove}) => {
    const messageFieldArr = email.getMessages()
      .map(extractFieldsFromMessage)
      .filter(f => f.amount);

    // process all providers
    const result = Object.keys(budgetTypes)
      .map(budget => processEmail(email, messageFieldArr, budgetTypes[budget], type))
      .reduce((res, cur) => res && cur, true);
    if (result) {
      email
        .removeLabel(labelToRemove)
        .moveToArchive();
    }
  });
}

/**
 * Processes a single email
 * @param email {GmailApp.GmailThread} Message to process
 * @param messageFieldArr {BudgetAutomation.TransactionFields[]} Fields for given email
 * @param budgetType {string} Type of account to process
 * @returns {boolean}
 */
function processEmail(email, messageFieldArr, budgetType, processingType = "CreditCard") {
  const { enabled, ordersLabelToAdd, transactionLabelToAdd, functToRun, name } = budgetType;
  if (!enabled) {
    Logger.log(`${name} processing is disabled. Skipping.`);
    return true;
  }
  let labelToAdd;
  if (processingType === "CreditCard") {
    labelToAdd = transactionLabelToAdd;
  } else if (processingType === "Orders") {
    labelToAdd = ordersLabelToAdd;
  }

  if (email.getLabels().indexOf(labelToAdd) >= 0) {
    Logger.log(`${name} has already been processed for this transaction. Skipping.`);
    return true;
  }
  
  const result = messageFieldArr
    .map(functToRun)
    .filter(res => res == false);
  if (result.length === 0) {
    email.addLabel(labelToAdd);
  }

  return result.length === 0;
}

/**
 * Processes an email for YNAB
 * 
 * @returns {boolean}
 */
function processYnab({ ynab: { account }, amount, merchant, notes, category }) {
  const transaction = {
    budgetId: ynabBudget.id,
    accountId: account,
    amount,
    payeeName: merchant,
    approved: false,
    memo: notes || undefined,
    category
  };

  Logger.log(`About to submit YNAB transaction for '${merchant}' in the amount of '${amount}'`);
  // submit ynab transaction
  const res = enterTransaction(transaction);
  return Math.round(res.getResponseCode() / 100) === 2;
}

/**
 * Processes a Firefly transaction
 * @param {BudgetAutomation.TransactionFields} Fiedls required to submit transaction
 */
function processFirefly({ firefly: { account }, merchant, amount }) {
  let partial = {}
  if (amount < 0) {
    // we are dealing with a withdrawal
    partial = {
      type: 'withdrawal',
      amount: amount * -1,
      source_id: account,
      destination_name: merchant.toUpperCase()
    };
  } else {
    // we are dealing with a withdrawal
    partial = {
      type: 'deposit',
      amount,
      source_name: merchant && merchant.toUpperCase() || undefined,
      destination_id: account
    };
  }

  Logger.log(`About to submit FireFly ('${partial.type}') transaction for '${merchant}' in the amount of '${amount}'`)
  const payload = {
    error_if_duplicate_hash: true,
    apply_rules: true,
    fire_webhooks: true,
    transactions: [{
      ...partial,
      date: new Date().toISOString(), // "2018-09-17T12:46:47+01:00",
      description: 'Entered by Google Apps Script',
      order: 0
    }
  ]};

  return addFireflyTransaction(payload);

}
/**
 * Extracts required fields from email (Merchange, Amount, Account)
 * @param message {GmailApp.GmailMessage} Message to extract fields from
 * @returns {BudgetAutomation.TransactionFields}
 */
function extractFieldsFromMessage(message) {
    const accountName = Object.keys(accountsMap)
      .filter(a => accountsMap[a].match(message.getFrom()))
      .shift();
    if (accountName) {
      Logger.log(`Found account '${accountName}'`);

      const account = accountsMap[accountName];
      return account.fields(message.getBody());
    }

    const merchantName = Object.keys(merchantEmailsMap)
      .filter(a => merchantEmailsMap[a].match(message.getFrom()))
      .shift();

    if (merchantName) {
      Logger.log(`Found merchant '${merchantName}'`);
      const merchant = merchantEmailsMap[merchantName];
      return merchant.fields(message.getBody());
    }
    Logger.log(`Failed find account or merchant for email from ${message.getFrom()}`);
    return false;
}
