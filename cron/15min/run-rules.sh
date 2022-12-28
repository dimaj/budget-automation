#!/bin/sh

#########################################################################
# Description:                                                          #
#   Trigger all rules for all transactions between yesterday and today. #
#   This has a value when your transactions get imported by an external #
#   script and you don't have a rule for that transaction yet.          #
#                                                                       #
# Configuration:                                                        #
#  set 'endpoint' to your Firefly-III endpoint (e.g. http://app:8080    #
#  set 'token' to your Personal Access Token                            #
#   https://docs.firefly-iii.org/firefly-iii/api/#personal-access-token #
#                                                                       #
#########################################################################

endpoint="SET YOUR FF INSTANCE URL. e.g: http://app:8080"

token="ENTER YOUR ACCESS TOKEN HERE"

# get list of rules
rules=`curl -s "${endpoint}/api/v1/rule_groups?page=1" \
    -H 'accept: application/vnd.api+json' \
    -H "Authorization: Bearer ${token}" \
    | jq -r ".data[]|.id"`

accounts=""
for accountId in $(curl -s "${endpoint}/api/v1/accounts?page=1&type=asset" \
    -H 'accept: application/vnd.api+json' \
    -H "Authorization: Bearer ${token}" \
    | jq -r ".data[]|.id"); do
  accounts="${accounts}&accounts%5B%5D=${accountId}"
done

today=`date +%F`
yesterday=`date -d @$(($(date +%s) - 3600 * 24)) +%F`
for ruleId in $rules; do
  url="${endpoint}/api/v1/rule_groups/${ruleId}/trigger?start=${yesterday}&end=${today}${accounts}"
  curl -s -XPOST \
    -H "Authorization: Bearer ${token}" \
    -H 'accept: application/json' \
    -d '' \
    "${url}" | jq
done

echo "Finished triggering rules at $(date +'%F %T')"
