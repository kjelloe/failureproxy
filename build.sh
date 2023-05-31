#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}")" # Change working directory to directoru of script
docker build -t $USER/node-failureproxy .
