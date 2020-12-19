import { runInNewContext } from 'vm';
import { createServer, IncomingMessage } from 'http';

import { Image, Frame, GIF } from 'imagescript'

import * as config from './config.json';

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

function parseBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk: string) => data += chunk);
        req.on('end', () => resolve(data));
    });
}

async function executeImageScript(script: string) {
    let result: [Image | GIF | undefined, string | undefined];
    const scriptToExecute = 
`${script.slice(1, script.length - 1)}
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
    result = runInNewContext(scriptToExecute, {
        Image,
        Frame,
        GIF,
        console
    }, { timeout: config.timeout, });

    let output: [Buffer | undefined, string | undefined] = [undefined, undefined];
    if(result[0]) {
        const buffer = await result[0].encode();
        output[0] = buffer;
    }
    output[1] = result[1];

    return output;
}

createServer(async (req, res) => {
    const { method, headers } = req;
    if (method?.toLowerCase() !== RequestMethods.POST) {
        res.statusCode = ResponseCodes.METHOD_NOT_ALLOWED;
        return res.end();
    } else if (headers.authorization !== config.authorization) {
        res.statusCode = ResponseCodes.UNAUTHORIZED;
        return res.end();
    }
    const script = await parseBody(req);
    let result: [Buffer | undefined, string | undefined] = [undefined, undefined];
    try {
        result = await executeImageScript(script);
    } catch(e) {
        res.statusCode = ResponseCodes.BAD_REQUEST;
        res.write(e.stack);
        res.end();
    }
    if(result[1]) {
        res.setHeader('text', result[1]);
    }
    if(result[0]) {
        res.statusCode = ResponseCodes.OK;
        res.write(result[0]);
        res.end();
    } else {
        res.statusCode = ResponseCodes.NO_CONTENT;
        res.end();
    }
}).listen(config.port).on('listening', () => {
    console.log('listening on port ' + config.port)
});