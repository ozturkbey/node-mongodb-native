#! /usr/bin/env bash

set -o errexit

pushd "src"
PROJECT_DIRECTORY="$(pwd)"
export PROJECT_DIRECTORY
source ".evergreen/init-nvm.sh"

set -o xtrace

# TODO(NODE-5180): remove --force option
npm install --force 'mongodb-client-encryption@alpha'
npm install --force 'gcp-metadata'

export MONGODB_URI="mongodb://localhost:27017"

export EXPECTED_GCPKMS_OUTCOME=${EXPECTED_GCPKMS_OUTCOME:-omitted}
export TEST_CSFLE=true
export CSFLE_KMS_PROVIDERS='not json'

npx mocha --config test/mocha_mongodb.json test/integration/client-side-encryption/client_side_encryption.prose.17.on_demand_gcp.test.ts
