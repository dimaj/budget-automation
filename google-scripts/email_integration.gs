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
      if ((body.indexOf('You made') >= 0 && body.indexOf('transaction') >= 0) || body.indexOf('Order Confirmation') >= 0) {
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
      return [{ ...budgets, merchant, amount }];
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

      return [{ ynab, firefly, merchant, amount }];
    }
  },
  wellsfargo: {
    match: (from) => from.indexOf('notify.wellsfargo.com') >= 0,
    fields: (body) => {
      if (body.indexOf("You've reached your pre-set balance") >= 0) {
        return undefined;
      }

      const getTransactions = (tableData, multiplier) => {
        if (!tableData || tableData.length == 0) {
          return [];
        }

        return tableData[0]
          .split('<tr')
          .map(transaction => transaction.match(/<.+?>\b(.+)<\B.*\$([\d\.\,]+)/))
          .filter(transaction => transaction)
          .map(match => ({
            ynab: ynabAccountProperty.wellsfargo,
            firefly: fireflyAccountProperty.wellsfargo,
            merchant: getValueFromMatchAtIndex(match, 1),
            amount: multiplier * parseAmount(getValueFromMatchAtIndex(match, 2))
          }));
      }

      const withdrawals = body.match(/<table.+Withdrawals.*<\/table>/sm)
      const deposits = body.match(/<table.+Deposits.*<\/table>/sm)
      const transactions = [...getTransactions(withdrawals, -1), ...getTransactions(deposits, 1)]

      return transactions.length > 0 && transactions || undefined;
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
      // TODO: Update for refunds
      const multiplier = -1;

      amount *= multiplier;

      return [{ ynab, firefly, merchant, amount }];
    }
  },
  venmo: {
    match: from => from.indexOf('venmo@venmo.com') >= 0,
    fields: body => {
      const matches = body.match(/You.+<a.+?user_id.+?>\B(.+?)<.+?<p>(.+?)<\/.+?(\+|-\s*\$[\d\.\,]*).+?Completed via.+?(bank|Venmo).*?/ms);
      if (!matches || matches.length < 4) {
        return undefined;
      }
      const name = getValueFromMatchAtIndex(matches, 1);
      const notes = getValueFromMatchAtIndex(matches, 2);
      const amountStr = getValueFromMatchAtIndex(matches, 3);
      const multiplier = amountStr.indexOf('+') >= 0 ? 1 : -1;
      const amount = parseAmount(amountStr.split('$')[1]);
      const source = getValueFromMatchAtIndex(matches, 4);

      return [{
        ynab: source === 'Venmo' ? ynabAccountProperty.venmo : ynabAccountProperty.usbank,
        firefly: source === 'Venmo' ? fireflyAccountProperty.venmo : fireflyAccountProperty.usbank,
        merchant: name && name.trim(),
        amount: multiplier * amount,
        notes,
        cleared: source === 'Venmo' ? 'cleared' : 'uncleared'
      }]
    }
  },
  forex: {
    match: from => from.indexOf('metatrader@forex.com') >= 0,
    fields: body => {
      const tableMatch = body.matchAll(/Deals:.+?<\/tr>\s*(<tr.+?(?:<tr.+?Positions))/gsm);
      if (!tableMatch) {
        Logger.log("Could not find table with deal info");
        return undefined;
      }
      const table = Array.from(tableMatch).map(match => match[1]);
      if (table.length == 0) {
        Logger.log("Could not parse deals table");
        return undefined;
      }
      const rowsMatch = table[0].matchAll(/(<tr.+?<td.+?\<\/td>\s*<\/tr>)*/gsm);
      if (!rowsMatch) {
        Logger.log('Could not find rows in Deals table');
        return undefined;
      }
      const rows = Array.from(rowsMatch).map(row => row[1]).filter(row => row);
      const transactions = rows.map(row => Array.from(row.matchAll(/<td.*?>(.*?)<\/td>\s*/gsm)))
        .filter(cellMatch => cellMatch.length == 14)
        .map(cellMatch =>({
          time      : cellMatch[0][1],
          ticket    : parseInt(cellMatch[1][1]),
          type      : cellMatch[2][1],
          size      : parseFloat(cellMatch[3][1]),
          item      : cellMatch[4][1],
          price     : parseFloat(cellMatch[5][1]),
          order     : parseInt(cellMatch[6][1]),
          comment   : cellMatch[7][1] && XmlService.parse(`<d>${cellMatch[7][1]}</d>`).getRootElement().getText() || '',
          entry     : cellMatch[8][1],
          cost      : parseFloat(cellMatch[9][1]),
          commission: parseFloat(cellMatch[10][1]),
          fee       : parseFloat(cellMatch[11][1]),
          swap      : parseFloat(cellMatch[12][1]),
          profit    : parseFloat(cellMatch[13][1])
        }))
        // skip first element as it is a header
        .slice(1)
        .reduce((res, cur) => {
          const item = res.find(i => i.item == cur.item && i.size == cur.size && i.type !== cur.type && i.entry !== cur.entry && i.comment == cur.comment)
          if (!item) return [...res, cur];
          item.entry = item.entry !== cur.entry && "out" || item.entry;
          item.profit += cur.profit;
          item.commission += cur.commission;
          item.swap += cur.swap;
          item.fee += cur.fee;
          item.cost += cur.cost;
          item.type = cur.entry == "out" ? item.type : cur.type;
          item.ticket = cur.entry == "out" ? item.ticket : cur.ticket;
          return res;
        }, [])
        .filter(res => res.entry == "out" || res.type == "balance");
        // TODO: merge 'in' and 'out' and report back the 'order' number from the 'in' transaction
        return transactions.map(transaction => {          
          const comment = transaction.comment && `comment: ${transaction.comment}` || '';
          // since this is "out", the type is reversed
          const tType = transaction.type == "sell" ? "buy" : "sell";
          const notes = `${tType} ${transaction.size} at ${transaction.price}; ${comment} (ticket: ${transaction.order})`;
          return {
            ynab: ynabAccountProperty.forex,
            firefly: fireflyAccountProperty.forex,
            amount: transaction.profit,
            merchant: "ForEx.com",
            notes: transaction.type == "balance" ? transaction.comment : notes,
            cleared: 'cleared'
          }
        });
    }
  }
}

/**
 * Map of merchants to process
 */
const merchantEmailsMap = {
  amazon_orders: {
    match: (from) => from.indexOf('auto-confirm@amazon.com') >= 0,
    fields: (body) => {
      const matches = body.matchAll(/<a.+?orderId.+?>\s*(.*?)<.+?Order Total.+?\$([\d\.\,]*)/gsm)
      if (!matches) {
        return undefined;
      }

      return Array.from(matches).map( match => ({
        merchant: 'Amazon',
        notes: `${match[1]} #toProcess`,
        category: null,
        amount: parseAmount(match[2]) * -1,
        ynab: parseAmount(match[2]) == 0 ? ynabAccountProperty.amazon_gc : ynabAccountProperty.chase_amazon,
        firefly: parseAmount(match[2]) == 0 ? fireflyAccountProperty.amazon_gc : fireflyAccountProperty.chase_amazon
      }));
    }
  },
  amazon_refunds: {
    match: (from) => from.indexOf('return@amazon.com') >= 0,
    fields: (body) => {
      const amount = parseAmount(getValueFromMatchAtIndex(body.match(/Refund total:.*?\$([\d\.\,]*)/s), 1));
      const orderId = getValueFromMatchAtIndex(body.match(/orderID%3D([\d-]*)/s), 1);
      return {
        merchant: 'Amazon',
        notes: orderId,
        category: null,
        amount,
        ynab: body.indexOf('Refund will appear on your Visa') >= 0 ? ynabAccountProperty.chase_amazon : ynabAccountProperty.amazon_gc,
        firefly: body.indexOf('Refund will appear on your Visa') >= 0 ? fireflyAccountProperty.chase_amazon : fireflyAccountProperty.amazon_gc,
        cleared: body.indexOf('Refund is available now in your Amazon Account') >= 0 ? 'cleared' : 'uncleared'
      }
    }
  }
}

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
      .flatMap(extractFieldsFromMessage)
      .filter(f => f.amount !== null || f.amount !== undefined);

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
  if (messageFieldArr.length === 0) {
    Logger.log('No transactions to process. Skipping.');
    return true;
  }
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
function processYnab({ ynab: { account }, amount, merchant, notes, category, cleared = 'uncleared'}) {
  const transaction = {
    budgetId: getBudget(getPropertyValue('ynabBudgetName')).id,
    accountId: account,
    amount,
    payeeName: merchant,
    approved: false,
    memo: notes || undefined,
    category,
    cleared
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
