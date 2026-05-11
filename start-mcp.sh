#!/bin/bash
cd "$(dirname "$0")"
exec bun src/index.ts "$@"
