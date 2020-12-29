import { runInNewContext } from 'vm';
import { createServer, IncomingMessage } from 'http';

import { Image, Frame, GIF } from 'imagescript'

import * as config from './config.json';

import * as SimplexNoise from 'simplex-noise';
import { inspect } from 'util';

type Serializable = string | number | boolean

interface Input {
    script: string
    inject?: { [key: string]: Serializable }
}

enum Format {
    PNG = 'png',
    GIF = 'gif'
}

interface Output {
    image?: Buffer
    text?: string
    cpuTime?: number
    format?: Format
}

enum RequestMethods {
    POST = 'post'
}

enum ResponseCodes {
    OK = 200,
    NO_CONTENT = 204,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    METHOD_NOT_ALLOWED = 405
}

function parseBody(req: IncomingMessage): Promise<Input> {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk: string) => data += chunk);
        req.on('end', () => resolve(JSON.parse(data)));
    });
}

async function executeImageScript(script: string, inject: { [key: string]: Serializable }): Promise<Output> {
    let text = '';
    const _console = {
        log: (arg: string) => text += String(arg) + '\n'
    }

    let result: Image | GIF | undefined;
    const scriptToExecute = 
`(async() => {
    ${script}
    const __typeofImage = typeof(image);
    if(__typeofImage === 'undefined') {
        return undefined;
    } else {
        return image;
    }
})()`
    const start = Date.now();
    try {
        result = await runInNewContext(scriptToExecute, {
            Image,
            Frame,
            GIF,
            SimplexNoise,
            _inspect: inspect,
            console: _console,
            ...inject
        }, { timeout: config.timeout, });
    } catch(e) {
        throw e;
    }

    if(result === undefined && (!text || text.trim() === '')) throw new Error('the script produced no output (define `image` or log something with `console.log()`)');
    if(result instanceof Promise) await result;
    if(!(result instanceof Image) && result !== undefined) throw new Error('`image` is not a valid Image');

    let output: Output = { 
        image: undefined, 
        text,
        cpuTime: Date.now() - start,
        format: result ? result instanceof Image ? Format.PNG : Format.GIF : undefined
    };
    if(result) {
        const buffer = await result.encode();
        output.image = buffer;
    }

    return output;
}

createServer(async (req, res) => {
    const { method, headers } = req;
    if (headers.authorization !== config.authorization) {
        res.statusCode = ResponseCodes.UNAUTHORIZED;
        return res.end();
    } else if (method?.toLowerCase() !== RequestMethods.POST) {
        res.statusCode = ResponseCodes.METHOD_NOT_ALLOWED;
        return res.end();
    }
    const data = await parseBody(req);
    const { script, inject } = data;
    let result: Output = {};
    let wallTime: number = 0;
    try {
        let start = Date.now();
        result = await executeImageScript(script, inject || {});
        wallTime = Date.now() - start;
    } catch(e) {
        res.statusCode = ResponseCodes.BAD_REQUEST;
        res.write(String(e))
        return res.end();
    }
    res.setHeader('x-cpu-time', result.cpuTime as number);
    res.setHeader('x-wall-time', wallTime);
    if(result.text) {
        const encodedHeader = String(result.text).split('').map(a => a.charCodeAt(0)).join(' ');
        res.setHeader('x-text', encodedHeader.slice(0, 7999));
    }
    if(result.format) {
        res.setHeader('x-format', result.format);
    }
    if(result.image) {
        res.statusCode = ResponseCodes.OK;
        res.write(result.image);
        res.end();
    } else {
        res.statusCode = ResponseCodes.NO_CONTENT;
        res.end();
    }
}).listen(config.port).on('listening', () => {
    console.log('listening on port ' + config.port)
});

process.on('unhandledRejection', console.error)