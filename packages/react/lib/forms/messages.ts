import { settings } from '../app/config';

export interface ValidationError{
    path: string;
    expected: string;
    value: unknown;
    description?: string;
}

export type Validation =
    | { success: true }
    | { success: false; errors: readonly ValidationError[] };

export interface FieldCopy{
    required: string;
    tooShort: (min: number) => string;
    tooLong: (max: number) => string;
    email: string;
    format: string;
    tooSmall: (min: number) => string;
    wholeNumber: string;
    invalid: string;
}

const ENGLISH: FieldCopy = {
    required: 'Required',
    tooShort: (min) => `At least ${min} characters`,
    tooLong: (max) => `At most ${max} characters`,
    email: 'Invalid email',
    format: 'Invalid format',
    tooSmall: (min) => `At least ${min}`,
    wholeNumber: 'Must be a whole number',
    invalid: 'Invalid value'
};

const tagged = (expected: string, tag: string): number | null => {
    const match = new RegExp(`${tag}<(\\d+)>`).exec(expected);
    return match === null ? null : Number(match[1]);
};

export const fieldOf = (path: string): string => path.replace(/^\$input\./, '').split(/[.[]/)[0];

export const messageOf = ({ expected, value, description }: ValidationError): string => {
    if(description !== undefined) return description;

    const copy = { ...ENGLISH, ...settings().copy?.fields };
    const length = typeof value === 'string' ? value.length : null;
    const min = tagged(expected, 'MinLength');
    const max = tagged(expected, 'MaxLength');
    const minimum = tagged(expected, 'Minimum');

    if(value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))) return copy.required;
    if(min !== null && length !== null && length < min) return min === 1 ? copy.required : copy.tooShort(min);
    if(max !== null && length !== null && length > max) return copy.tooLong(max);
    if(expected.includes('Format<"email">')) return copy.email;
    if(expected.includes('Pattern<')) return copy.format;
    if(minimum !== null && typeof value === 'number' && value < minimum) return copy.tooSmall(minimum);
    if(/Type<"u?int(32|64)?">/.test(expected) && typeof value === 'number' && !Number.isInteger(value)) return copy.wholeNumber;
    return copy.invalid;
};
