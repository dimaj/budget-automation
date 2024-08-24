const amazonOrderBaseUrl='https://www.amazon.com/gp/your-account/order-details?ie=UTF8&orderID=';

/**
 * Email type
 * @enum {string}
 */
const emailType = {
  CREDIT_CARD: 'CreditCard',
  ORDER: 'Orders'
};

/**
 * Returns configurations for various _enable_ providers
 * @param accountName {string} name of the account as defined by configuration parameter
 * @return map of providers
 */
function getProviderConfigs(accountName) {
  return Object.keys(budgetProviders)
    // filter out disabled providers
    .filter(provider => budgetProviders[provider].enabled)
    // convert output to be in a form of { key: { name: ..., id: ...}}
    .reduce((prev, cur) => ({ ...prev, [cur]: budgetProviders[cur].account(accountName)}), {})
}

/**
 * Map of available accounts.
 */
const accountsMap = {
  chase: {
    match: (from, body) => {

      if (from.indexOf('chase') === -1) { return false }
      if (IsNullOrUndefined(body)) { return true }

      const accountMatch = body.match(/Account<\/td>(.|\s)+?>((.|\s)+?)</m);
      const account = getValueFromMatchAtIndex(accountMatch, 2);
      return account && account.indexOf('4303') >= 0;
    },
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
      const providers = getProviderConfigs('chase_freedom');
      return [{ ...providers, merchant, amount }];
    }
  },
  chase_amazon: {
    match: (from, body) => {
      if (from.indexOf('chase') === -1) { return false }
      if (IsNullOrUndefined(body)) { return true }

      const accountMatch = body.match(/Account<\/td>(.|\s)+?>((.|\s)+?)</m);
      const account = getValueFromMatchAtIndex(accountMatch, 2);
      return account && account.indexOf('2953') >= 0;
    },
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
      const providers = getProviderConfigs('chase_amazon');
      return [{ ...providers, merchant, amount }];
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

      const providers = getProviderConfigs('citi');
      return [{ ...providers, merchant, amount }];
    }
  },
  wellsfargo: {
    match: (from) => from.indexOf('notify.wellsfargo.com') >= 0,
    fields: (body) => {
      if (body.indexOf("You've reached your pre-set balance") >= 0) {
        return undefined;
      }

      const providers = getProviderConfigs('wellsfargo');
      const getTransactions = (tableData, multiplier) => {
        if (IsNullOrUndefined(tableData) || tableData.length == 0) {
          return [];
        }

        return tableData[0]
          .split('<tr')
          .map(transaction => transaction.match(/<.+?>\b(.+)<\B.*\$([\d\.\,]+)/))
          .filter(transaction => transaction)
          .map(match => ({
            ...providers,
            merchant: getValueFromMatchAtIndex(match, 1),
            amount: multiplier * parseAmount(getValueFromMatchAtIndex(match, 2))
          }));
      };

      const tables = body.split('<table');
      const withdrawals = tables.filter(table => table.indexOf('Withdrawals') >= 0);
      const deposits = tables.filter(table => table.indexOf('Deposits') >= 0);
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
      // TODO: Update for refunds
      const multiplier = -1;
      const providers = getProviderConfigs('discover');

      const amount = parseAmount(getValueFromMatchAtIndex(amountMatch, 1)) * multiplier;

      return [{ ...providers, merchant, amount }];
    }
  },
  venmo: {
    match: from => from.indexOf('venmo@venmo.com') >= 0,
    fields: body => {
      const matches = body.match(/You.+<a.+?user_id.+?>\B(.+?)<.+?<p>(.+?)<\/.+?(\+|-\s*\$[\d\.\,]*).+?Completed via.+?(bank|Venmo).*?/ms);
      if (IsNullOrUndefined(matches) || matches.length < 4) {
        return undefined;
      }
      const name = getValueFromMatchAtIndex(matches, 1);
      const notes = getValueFromMatchAtIndex(matches, 2);
      const amountStr = getValueFromMatchAtIndex(matches, 3);
      const multiplier = amountStr.indexOf('+') >= 0 ? 1 : -1;
      const amount = parseAmount(amountStr.split('$')[1]);
      const source = getValueFromMatchAtIndex(matches, 4);

      const accountName = source.toLowerCase() === 'venmo' ? 'venmo' : 'usbank';
      const providers = getProviderConfigs(accountName);
      return [{
        ...providers,
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
      const providers = getProviderConfigs('forex');

      const tableMatch = body.matchAll(/Deals:.+?<\/tr>\s*(<tr.+?(?:<tr.+?Positions))/gsm);
      if (IsNullOrUndefined(tableMatch)) {
        Logger.log("Could not find table with deal info");
        return undefined;
      }
      const table = Array.from(tableMatch).map(match => match[1]);
      if (table.length == 0) {
        Logger.log("Could not parse deals table");
        return undefined;
      }
      const rowsMatch = table[0].matchAll(/(<tr.+?<td.+?\<\/td>\s*<\/tr>)*/gsm);
      if (IsNullOrUndefined(rowsMatch)) {
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
          if (IsNullOrUndefined(item)) return [...res, cur];
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
            ...providers,
            amount: transaction.profit,
            merchant: "ForEx.com",
            notes: transaction.type == "balance" ? transaction.comment : notes,
            cleared: 'cleared'
          }
        });
    }
  },
  paypal: {
    match: (from) => from.indexOf('paypal') >= 0,
    fields: body => {
      const params = [];
      if (payment = body.match(/You (paid|sent) \$([\d\.]+).*to (.+?)</)) {
        const accountMatch = body
          .split(/Paid.*?with/i)[1]
          .split(/(?=<td.+<\/td>)/g)
          .find(row => row.match(/<td.*<\/td>/))
          .match(/<td(.+?)<\//)
        const account = getValueFromMatchAtIndex(accountMatch, 1)
          .split('>')
          .slice(-1)
          .pop();
        const accountName = account.toLowerCase().indexOf('paypal') >= 0 ? 'paypal' : 'usbank';
        params.push(
          -1,
          parseAmount(getValueFromMatchAtIndex(payment, 2)),
          getValueFromMatchAtIndex(payment, 3),
          accountName
        );
      } else if (deposit = body.match(/<span>(.+?) sent you \$([\d\.]*).+?</)) {
        params.push(
          1,
          parseAmount(getValueFromMatchAtIndex(deposit, 2)),
          getValueFromMatchAtIndex(deposit, 1),
          'paypal'
        );
      }
      const [ multiplier, amount, merchant, accountName ] = params;

      const providers = getProviderConfigs(accountName);
      return [{...providers, merchant, amount: amount * multiplier }]
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
      if (IsNullOrUndefined(matches)) {
        return undefined;
      }

      return Array.from(matches).map( match => {
        const accountName = parseAmount(match[2]) == 0 ? 'amazon_gc' : 'chase_amazon';
        const providers = getProviderConfigs(accountName);

        return {
          merchant: 'Amazon',
          notes: `#to-process [${match[1]}](https://www.amazon.com/gp/your-account/order-details?ie=UTF8&orderID=${match[1]})`,
          category: null,
          amount: parseAmount(match[2]) * -1,
          ...providers,
          // since gift cards are being charged immediately, clear the transaction
          cleared: accountName === 'amazon_gc' ? 'cleared' : undefined
        }
      });
    }
  },
  amazon_refunds: {
    match: (from) => from.indexOf('return@amazon.com') >= 0,
    fields: (body) => {
      const amount = parseAmount(getValueFromMatchAtIndex(body.match(/Refund total:.*?\$([\d\.\,]*)/s), 1));
      const orderId = getValueFromMatchAtIndex(body.match(/orderID%3D([\d-]*)/s), 1);
      const accountName = body.indexOf('Refund will appear on your Visa') >= 0 ? 'chase_amazon' : 'amazon_gc';
      const providers = getProviderConfigs(accountName);
      return {
        merchant: 'Amazon',
        notes: `#to-process [${orderId}](https://www.amazon.com/gp/your-account/order-details?ie=UTF8&orderID=${orderId})`,
        // notes: orderId,
        category: null,
        amount,
        ...providers,
        cleared: body.indexOf('Refund is available now in your Amazon Account') >= 0 ? 'cleared' : 'uncleared'
      }
    }
  }
}


/**
 * Processes a single email
 * @param email {GmailApp.GmailThread} Message to process
 * @param messageFieldArr {BudgetAutomation.TransactionFields[]} Fields for given email
 * @param budgetType {string} Type of account to process
 * @return {boolean}
 */
function processEmail(email, messageFieldArr, budgetType, processingType = emailType.CREDIT_CARD) {
  if (messageFieldArr.length === 0) {
    Logger.log('No transactions to process. Skipping.');
    return true;
  }
  const { enabled, labels: { ordersDone, transactionDone }, functToRun, name } = budgetType;
  if (!enabled) {
    Logger.log(`${name} processing is disabled. Skipping.`);
    return true;
  }
  let labelToAdd;
  if (processingType === emailType.CREDIT_CARD) {
    labelToAdd = transactionDone;
  } else if (processingType === emailType.ORDER) {
    labelToAdd = ordersDone;
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
 * Extracts required fields from email (Merchange, Amount, Account)
 * @param message {GmailApp.GmailMessage} Message to extract fields from
 * @param messageType Should be 'CreditCard' or 'Orders'
 * @return {BudgetAutomation.TransactionFields}
 */
function extractFieldsFromMessage(message, messageType) {
  const accounts = messageType === emailType.CREDIT_CARD 
    ? accountsMap
    : messageType === emailType.ORDER
      ? merchantEmailsMap
      : undefined;
  if (!accounts) {
    Logger.log(`Unknown email type: ${messageType}. Skipping.`);
    return false;
  }
  
  const fields = Object.keys(accounts)
    .filter(account => accounts[account].match(message.getFrom(), message.getBody()))
    .map(account => accounts[account].fields(message.getBody()))
    .shift();
  return fields;
}
