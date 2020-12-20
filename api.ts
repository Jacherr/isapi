import { runInNewContext } from 'vm';
import { createServer, IncomingMessage } from 'http';

import { Image, Frame, GIF } from 'imagescript'

import * as config from './config.json';

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
    let result: [Image | GIF | undefined, string | undefined];
    const scriptToExecute = 
`${script}
const __typeofImage = typeof(image);
const __typeofText = typeof(text);
if(__typeofImage === 'undefined' && __typeofText === 'undefined') {
    throw new Error('no image or text was defined');
} else if(__typeofImage !== 'undefined' && __typeofText === 'undefined') {
    [image, undefined];
} else if(__typeofImage === 'undefined' && __typeofText !== 'undefined') {
    [undefined, text];
} else {
    [image, text];
}`
    const start = Date.now();
    result = runInNewContext(scriptToExecute, {
        Image,
        Frame,
        GIF,
        ...inject
    }, { timeout: config.timeout, });

    let output: Output = { 
        image: undefined, 
        text: undefined, 
        cpuTime: Date.now() - start,
        format: result[0] ? result[0] instanceof Image ? Format.PNG : Format.GIF : undefined
    };
    if(result[0]) {
        const buffer = await result[0].encode();
        output.image = buffer;
    }
    output.text = result[1];

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
        res.write(e.stack);
        return res.end();
    }
    res.setHeader('x-cpu-time', result.cpuTime as number);
    res.setHeader('x-wall-time', wallTime);
    if(result.text) {
        res.setHeader('x-text', result.text);
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