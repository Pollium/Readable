import { createParamDecorator } from '../http/params';
import { principalId } from './principalId';

export const CurrentUser = (): ParameterDecorator => createParamDecorator(principalId);
