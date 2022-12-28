#!/bin/sh

#########################################################################
# Description:                                                          #
#   Delete all 'expense' accounts that have current balance set to 0.00 #
#                                                                       #
# Configuration:                                                        #
#  set 'endpoint' to your Firefly-III endpoint (e.g. http://app:8080    #
#  set 'token' to your Personal Access Token                            #
#   https://docs.firefly-iii.org/firefly-iii/api/#personal-access-token #
#                                                                       #
#########################################################################

endpoint="SET YOUR FF INSTANCE URL. e.g: http://app:8080"

token="ENTER YOUR ACCESS TOKEN HERE"

accounts=$(curl -s \
  -H 'accept: application/vnd.api+json' \
  -H "Authorization: Bearer $token" \
  "$endpoint/api/v1/accounts?type=expense" \
  | jq -r '.data[]|select(.attributes.current_balance == "0.00")|.id' \
)

echo "About to delete $(echo $accounts | wc -w) accounts: $accounts"
for id in $accounts; do
  echo "Deleting account '$id'"
  curl -sXDELETE -H "Authorization: Bearer $token" "$endpoint/api/v1/accounts/$id" && echo "...done" || echo "...failed"
done
