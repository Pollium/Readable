import { describeError, ErrorCopy } from '../errors/copy';
import { ApiError, toError } from '../http/ApiError';
import { pathOf, PathValues, request } from '../http/call';
import { refreshAfter } from '../query/useMutation';
import { fieldOf, messageOf, Validation } from './messages';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { FormEvent, useRef, useState } from 'react';

export type Validator<T> = (input: T) => Validation;

type Errors = Partial<Record<string, string>>;

export interface FormOptions<I, O>{
    initial: I;
    path?: PathValues;
    validate?: Validator<I>;
    copy?: ErrorCopy;
    fieldOf?: Readonly<Partial<Record<string, keyof I & string>>>;
    invalidates?: readonly Pick<Endpoint, 'path'>[];
    onDone?: (output: O, values: I) => void;
    onFail?: (error: Error, values: I) => void;
}

export interface FieldBinding<V>{
    name: string;
    value: V;
    onChange: (value: V) => void;
    onBlur: () => void;
    isInvalid: boolean;
    errorMessage: string | undefined;
}

export interface Form<I>{
    values: I;
    errors: Partial<Record<keyof I, string>>;
    submitting: boolean;
    submitError: string | null;
    isValid: boolean;
    field: <K extends keyof I & string>(name: K) => FieldBinding<I[K]>;
    handleSubmit: (event?: FormEvent) => void;
    setValues: (patch: Partial<I>) => void;
    reset: () => void;
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

export const useForm = <I extends object, O>(
    endpoint: Endpoint<I, O>,
    { initial, path, validate, copy = describeError, fieldOf: fieldsByCode = {}, invalidates, onDone, onFail }: FormOptions<I, O>
): Form<I> => {
    const [values, setValuesState] = useState<I>(initial);
    const [errors, setErrors] = useState<Errors>({});
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const current = useRef(values);
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

    const submit = async (input: I) => {
        try{
            const output = await request(endpoint, { path, body: input }) as O;
            void refreshAfter(endpoint.method, pathOf(endpoint.path, path), invalidates);
            onDone?.(output, input);
        }catch(cause: unknown){
            fail(cause, input);
        }finally{
            sending.current = false;
            setSubmitting(false);
        }
    };

    const handleSubmit = (event?: FormEvent) => {
        event?.preventDefault();
        if(sending.current) return;

        const input = current.current;
        const found = check(input);
        Object.keys(input).forEach((field) => touched.current.add(field));
        setErrors(found);
        if(Object.keys(found).length > 0) return;

        sending.current = true;
        setSubmitting(true);
        setSubmitError(null);
        void submit(input);
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

    return {
        values,
        errors: errors as Partial<Record<keyof I, string>>,
        submitting,
        submitError,
        isValid: validate === undefined || validate(values).success,
        field,
        handleSubmit,
        setValues: (patch) => {
            commit({ ...current.current, ...patch });
            setErrors((previous) => without(previous, Object.keys(patch)));
        },
        reset: () => {
            commit(initial);
            touched.current.clear();
            setErrors({});
            setSubmitError(null);
        }
    };
};
