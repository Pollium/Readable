const CALL = /\buseForm\((\s*)([\w$.]+)(\s*),(\s*)\{/g;

export const autoValidateForm = () => ({
    name: 'readable:auto-validate-form',
    enforce: 'pre' as const,
    transform(code: string, id: string){
        if(id.includes('/node_modules/') || !/\.tsx?(\?.*)?$/.test(id)) return null;
        if(!new RegExp(CALL.source).test(code)) return null;

        let out = code.replace(CALL, 'useForm($1$2$3,$4{ validate: typia.createValidate<ReadableFormInput<typeof $2>>(),');
        if(!/^import typia\b/m.test(code)) out += "\nimport typia from 'typia';\n";
        out += "\nimport type { InputOf as ReadableFormInput } from '@pollium/readable-contracts/routing';\n";
        return {
            code: out,
            map: null
        };
    }
});
