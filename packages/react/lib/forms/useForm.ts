import { describeError, ErrorCopy } from '../errors/copy';
import { ApiError, toError } from '../http/ApiError';
import { pathOf, PathValues, request } from '../http/call';
import { refreshAfter } from '../query/useMutation';
import { fieldOf, messageOf, Validation } from './messages';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { FormEvent, useRef, useState } from 'react';

export type Validator<T> = (input: T) => Validation;

export type Submit<I, O> = (values: I) => O | PromiseLike<O>;

type Errors = Partial<Record<string, string>>;

interface FormBase<I, O>{
    initial: I;
    validate?: Validator<I>;
    copy?: ErrorCopy;
    fieldOf?: Readonly<Partial<Record<string, keyof I & string>>>;
    onDone?: (output: O, values: I) => void;
    onFail?: (error: Error, values: I) => void;
}

export interface FormOptions<I, O> extends FormBase<I, O>{
    path?: PathValues;
    invalidates?: readonly Pick<Endpoint, 'path'>[];
}

export interface LocalFormOptions<I, O> extends FormBase<I, O>{
    submit?: Submit<I, O>;
}

export interface SubmitCall<I, O>{
    submit?: Submit<I, O>;
    fields?: readonly (keyof I & string)[];
}

export interface FieldBinding<V>{
    name: string;
    value: V;
    onChange: (value: V) => void;
    onBlur: () => void;
    isInvalid: boolean;
    errorMessage: string | undefined;
}

export interface Watch<I>{
    <K extends keyof I & string>(name: K): I[K];
    (): I;
}

export interface Form<I, O = unknown>{
    values: I;
    errors: Partial<Record<keyof I, string>>;
    submitting: boolean;
    submitError: string | null;
    isValid: boolean;
    field: <K extends keyof I & string>(name: K) => FieldBinding<I[K]>;
    watch: Watch<I>;
    validateField: (name: keyof I & string) => boolean;
    validateFields: (names?: readonly (keyof I & string)[]) => boolean;
    setFieldError: (name: keyof I & string, message: string | null | undefined) => void;
    handleSubmit: (event?: FormEvent | null, call?: SubmitCall<I, O>) => void;
    setValues: (patch: Partial<I>) => void;
    reset: (values?: I) => void;
}

export interface UseForm{
    <I extends object, O = void>(options: LocalFormOptions<I, O>): Form<I, O>;
    <I extends object, O>(endpoint: Endpoint<I, O>, options: FormOptions<I, O>): Form<I, O>;
}

const errorsOf = (validation: Validation): Errors => {
    if(validation.success) return {};

    const errors: Errors = {};
    for(const error of validation.errors){
        const field = fieldOf(error.path);
        errors[field] ??= messageOf(error);
    }
    return errors;
};

const without = (errors: Errors, fields: readonly string[]): Errors =>
    Object.fromEntries(Object.entries(errors).filter(([field]) => !fields.includes(field)));

const only = (errors: Errors, fields: readonly string[]): Errors =>
    Object.fromEntries(Object.entries(errors).filter(([field]) => fields.includes(field)));

// A form either sends its values to an endpoint, and refreshes like a mutation, or hands them to its own
// submit. Validation, field errors and the submit error work the same for both.
export const useForm: UseForm = <I extends object, O>(
    ...[first, second]: [LocalFormOptions<I, O>] | [Endpoint<I, O>, FormOptions<I, O>]
): Form<I, O> => {
    const endpoint = second === undefined ? null : first as Endpoint<I, O>;
    const options: LocalFormOptions<I, O> & FormOptions<I, O> = second ?? first as LocalFormOptions<I, O>;
    const { initial, path, validate, copy = describeError, fieldOf: fieldsByCode = {}, invalidates, onDone, onFail } = options;
    const [values, setValuesState] = useState<I>(initial);
    const [errors, setErrors] = useState<Errors>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const current = useRef(values);
    const restart = useRef<I | null>(null);
    const touched = useRef(new Set<string>());
    const sending = useRef(false);

    const check = (input: I): Errors => validate === undefined ? {} : errorsOf(validate(input));

    const commit = (next: I) => {
        current.current = next;
        setValuesState(next);
    };

    const recheck = (field: string, input: I) => {
        const found = check(input)[field];
        setErrors((previous) => found === undefined ? without(previous, [field]) : { ...previous, [field]: found });
    };

    // Checking the whole form replaces every error, those the api answered too; checking some fields, a
    // step's, leaves the others' as they are.
    const checkFields = (fields: readonly string[] | null): boolean => {
        const all = check(current.current);
        const found = fields === null ? all : only(all, fields);
        (fields ?? Object.keys(current.current)).forEach((field) => touched.current.add(field));
        setErrors((previous) => fields === null ? found : { ...without(previous, fields), ...found });
        return Object.keys(found).length === 0;
    };

    const fail = (cause: unknown, input: I) => {
        const error = toError(cause);
        const message = copy(error) ?? error.message;
        const named = error instanceof ApiError ? fieldsByCode[error.code] : undefined;
        const onFields = {
            ...error instanceof ApiError ? error.fields : {},
            ...named === undefined ? {} : { [named]: message }
        };

        setErrors((previous) => ({ ...previous, ...onFields }));
        if(!Object.keys(onFields).some((field) => field in current.current)) setSubmitError(message);
        onFail?.(error, input);
    };

    const own: Submit<I, O> = endpoint === null
        ? options.submit ?? (() => undefined as O)
        : (input) => request(endpoint, { path, body: input }) as Promise<O>;

    const send = async (action: Submit<I, O>, input: I, refreshes: boolean) => {
        try{
            const output = await action(input);
            if(refreshes && endpoint !== null) void refreshAfter(endpoint.method, pathOf(endpoint.path, path), invalidates);
            onDone?.(output, input);
        }catch(cause: unknown){
            fail(cause, input);
        }finally{
            sending.current = false;
            setSubmitting(false);
        }
    };

    const handleSubmit = (event?: FormEvent | null, call: SubmitCall<I, O> = {}) => {
        event?.preventDefault();
        if(sending.current) return;

        const input = current.current;
        if(!checkFields(call.fields ?? null)) return;

        sending.current = true;
        setSubmitting(true);
        setSubmitError(null);
        void send(call.submit ?? own, input, call.submit === undefined);
    };

    const field = <K extends keyof I & string>(name: K): FieldBinding<I[K]> => ({
        name,
        value: values[name],
        onChange: (value) => {
            const next = { ...current.current, [name]: value };
            commit(next);
            if(touched.current.has(name)) recheck(name, next);
        },
        onBlur: () => {
            touched.current.add(name);
            if(!sending.current) recheck(name, current.current);
        },
        isInvalid: errors[name] !== undefined,
        errorMessage: errors[name]
    });

    const watch = ((name?: keyof I & string) => name === undefined ? values : values[name]) as Watch<I>;

    return {
        values,
        errors: errors as Partial<Record<keyof I, string>>,
        submitting,
        submitError,
        isValid: validate === undefined || validate(values).success,
        field,
        watch,
        validateField: (name) => checkFields([name]),
        validateFields: (names) => checkFields(names ?? null),
        setFieldError: (name, message) => {
            touched.current.add(name);
            setErrors((previous) => message === null || message === undefined ? without(previous, [name]) : { ...previous, [name]: message });
        },
        handleSubmit,
        setValues: (patch) => {
            commit({ ...current.current, ...patch });
            setErrors((previous) => without(previous, Object.keys(patch)));
        },
        reset: (next) => {
            if(next !== undefined) restart.current = next;
            commit(restart.current ?? initial);
            touched.current.clear();
            setErrors({});
            setSubmitError(null);
        }
    };
};
