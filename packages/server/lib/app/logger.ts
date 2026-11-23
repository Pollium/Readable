import pino, { Logger as PinoLogger } from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type LogMethod = 'debug' | 'info' | 'warn';
export type LogContext = Record<string, unknown>;

export interface LoggerOptions{
    level: LogLevel;
    pretty: boolean;
}

export class Logger{
    #pino: PinoLogger;

    constructor(instance?: PinoLogger){
        this.#pino = instance ?? pino({ level: 'info' });
    }

    configure(options: LoggerOptions){
        this.#pino = pino({
            level: options.level,
            transport: options.pretty ? { target: 'pino-pretty' } : undefined
        });
    }

    child(bindings: LogContext): Logger{
        return new Logger(this.#pino.child(bindings));
    }

    #log(level: LogMethod, message: string, context?: LogContext){
        this.#pino[level](context ?? {}, message);
    }

    debug(message: string, context?: LogContext){
        this.#log('debug', message, context);
    }

    info(message: string, context?: LogContext){
        this.#log('info', message, context);
    }

    warn(message: string, context?: LogContext){
        this.#log('warn', message, context);
    }

    error(message: string, error?: unknown, context?: LogContext){
        this.#pino.error({ ...context, err: error }, message);
    }

    get raw(): PinoLogger{
        return this.#pino;
    }
}

export const logger = new Logger();
