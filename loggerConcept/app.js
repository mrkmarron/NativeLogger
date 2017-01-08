//This is the main module of the app we are working on

let logger = require('logging')({
    moduleName: 'foo', //Name we are giving to this logger (all requires that use same name get same logger object)
    srcFile: __filename, //Name of the source file this logger is being required in
    writeLevel: 'WARN', //The log-level that we write out at (to disk or console)
    logLevel: 'TRACE'  //The log-level that is saved into the memory buffer
});

logger.configure({
    //Does is make sense to allow/configure things like: 
    //    (1) Standard prefixes (commonly time, host, et.c) for all messages -- rather than requiring it to be explicit in every format
    //    (2) Enabling per request log buffers -- as suggested by Mike
});

logger.addMsgFormats({
    //A json format specifier that logs the start of a http request -- uses auto traced macros for current request_id and time
    //also mixes literal json constructs and nested objects/arrays.
    requestBegin: {kind: 'begin', format: {reqid: '#request_id', time: '#walltime', info: {requrl: '${0:g}', srcIp: '${1:s}'}}},
    requestEnd: {kind: 'end', format: {reqid: '#request_id', time: '#walltime', status: '${1:s}'}}
});

//helper is set to log at a high(er) level, TRACE, but since it loads the logger as a sub-logger 
//it the levels will be reduced to WARN by default (can also exclude or set specific levels for sub-loggers).
let helper = require('./helper.js');

function initRequest(req, res) {
    //Log the trace statement with the format given by 'requestBegin'. The request_id will be auto-populated by Node builtin 
    //module and the walltime will be 'efficiently' inserted/formatted as well. The user provides the data that goes to the 
    //${0:g} general format specifier and ${1:s} string format specifier.
    logger.trace(logger.requestBegin, req.url, req.connection.remoteAddress);

    setTimeout(function(){
        completeRequest(res);
    }, 50);
} 

function completeRequest(res) {
    res.write('Hello World!!!');
    res.end();

    //Log the trace statement with the format given by 'requestEnd'. The request_id will be auto-populated by Node builtin 
    //module. As specified in the configuration -- the data will be placed in the in mmeory queue but unless an error occours 
    //this will not be written to the log file on disk (since the write level is WARN)
    logger.trace(logger.requestEnd, 'ok');
};


let http = require('http');
let server = http.createServer(initReq);

