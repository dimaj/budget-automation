Google Scripts for Budget Automation
---
This folder has a collection of scripts to be used in Google Scripts to automate you budgeting needs.

## Setup
To use these scripts, the following must be done:
* Create a new project in https://script.google.com/
* Under `Project Settings` -> `Script Properties` create set of properties that are needed for these scripts (property names and what they do are defined below).
* Under `Editor`, create new files and paste contents in them. You can have a single file that has all code or break them up into separate set of files. At the end of the day, all files get concatenated behind the scenes anyway.

## YNAB
To make YNAB scripts work, the following project properties are needed:
| Property Name | Description |
|---------------|-------------|
| ynabToken | Token used to authenticate against YNAB. This token can be acquired here: https://app.ynab.com/settings/developer (e.g. `1221lkjafsf132412lkajsfas09` |
| ynabStocksAccountName | Name of the investment account as visible in your YNAB application (e.g. `Fidelity`) |
| ynabStocksBudgetName | Name of your YNAB budget as visible in your YNAB application (e.g. `Main Budget`)|
| ynabEmailAutomationAccounts | JSON object that defines account mappings. See example below |
| ynabBudgetName | Name of the budget as visible in YNAB application. This is essentially duplicate of `ynabStocksBudgetName` |

## FireFly
For firefly, these properties are needed:
| Property Name | Description |
|---------------|-------------|
| firefly-endpoint | URL for your instance of FireFly |
| firefly-pat | Access token to make API requests against your instance of FireFly |
| fireflyEmailAutomationAccounts | A JSON object that defines your account information. |

## ActualBudget
By default, [ActualBudget](actualbudget.org) does not have RESTful API. In order to make it work, you'll need to deploy [actual-http-api](https://github.com/jhonderson/actual-http-api). Once actual-http-api service has been deployed, the following properties are needed:
| Property Name | Description |
|---------------|-------------|
| actualApiEndpoint | URL for your instance of ActualBudget HTTP Server |
| actualApiKey | API token for [actual-http-api](https://github.com/jhonderson/actual-http-api) Server |
| actualBudgetId | Budget Sync ID for budget file |
| actualEmailAutomationAccounts | A JSON object that defines account infomration. |


## *EmailAutomationAccounts property definitions
These properties are used to define a map of Account Name to Account ID as they are defined in a budget app of your choosing.
### YNAB
```
{
    "citi": { "account": "UUID of your account", "name": "Main Checking" },
    "discover": { "account": "UUID of your account", "name": "Main CreditCard" }
}
```
UUID of your account can be found in the url after clicking on the account name in the left panel.


### FireFly
```
{
    "citi": { "account": "account_uuid", "name": "Main Checking" },
    "discover": { "account": "account_uuid", "name": "Main CreditCard" }
}
```

### Actual
```
{
    "citi": { "account": "account_uuid", "name": "Main Checking" },
    "discover": { "account": "account_uuid", "name": "Main CreditCard" }
}
```
