#!/bin/sh
# Publish dsh-qianwen-status-dashboard to npm.
# Requires: 2FA enabled on the npm account (npm publish will prompt for a one-time code).
set -e
cd "$(dirname "$0")"
node -e "const p=require('./package.json');console.log('publishing',p.name+'@'+p.version)"
npm publish --access public
