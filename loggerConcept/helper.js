//This is a sub-module -- possible from NPM that

//Require logging in this sub-module
let logger = require('logging')({
    moduleName: 'helper', //Name we are giving to this logger (all requires that use same name get same logger object)
    srcFile: __filename, //Name of the source file this logger is being required in
    writeLevel: 'TRACE', //The log-level that we write out at (to disk or console)
    logLevel: 'TRACE'  //The log-level that is saved into the memory buffer
});

logger.addMsgFormats({
    //A printf style format specifier that takes a string and auto expands the module_name and walltime macros
    argError: {format: "An call argument was missing or invalid in ${0:s} in #module_name at #walltime!"},

    //A printf style format specifier that takes a string and auto expands the module_name macro
    callArgTrace: {format: "Calling function ${0:s} with ${1:g}"}
});

exports.printDigits = function (arg) {
    //Log the trace statement with the format given by 'callArgTrace' 
    logger.logTrace(logger.callArgTrace, 'printDigits');

    //Log the warning message with the format 'argError' if the condition is true -- help reduce branch logic clutter
    logger.logWarnOn(typeof(arg) !== 'number', logger.argError, 'printDigits');

    /* Do stuff here... */
};

