import { PAYLOAD, SOCKET, GatewayContext } from '../../gateway/create-context';
import { createParamDecorator } from '../../http/params';

export const Payload = (): ParameterDecorator =>
    createParamDecorator((req) => (req as GatewayContext)[PAYLOAD]);

export const Socket = (): ParameterDecorator =>
    createParamDecorator((req) => (req as GatewayContext)[SOCKET]);
