import { GatewayErrors } from '@pollium/readable-contracts/errors';
import { defineErrors } from '../utils/errors/define-errors';

export const GatewayError = defineErrors(GatewayErrors);