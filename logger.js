//-------------------------------------------------------------------------------------------------------
// Copyright (C) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//-------------------------------------------------------------------------------------------------------

//This code implements a node module that uses native runtime support to implement ultra-low overhea logging.

'use strict';

let process = require('process');

let sanityAssert = function (cond, msg) {
    if (!cond) {
        console.log(msg);
        exit(1);
    }
}

let s_loggingLevels = {
    LEVEL_OFF: { name: 'OFF', enum: 0x0 },
    LEVEL_FATAL: { name: 'FATAL', enum: 0x1 },
    LEVEL_ERROR: { name: 'ERROR', enum: 0x3 },
    LEVEL_CORE: { name: 'CORE', enum: 0x7 },
    LEVEL_WARN: { name: 'WARN', enum: 0xF },
    LEVEL_INFO: { name: 'INFO', enum: 0x1F },
    LEVEL_DEBUG: { name: 'DEBUG', enum: 0x3F },
    LEVEL_TRACE: { name: 'TRACE', enum: 0x7F },
    LEVEL_ALL: { name: 'ALL', enum: 0xFF }
};

/**
 * 
 */

/**
 * Logger constructor function.
 * @exports
 * @function
 * @param {string} name of the logger object to construct (calls with the same name will return an aliased logger object)
 * @param {string} lfilename is the '__filename' of the src file this logger is being loaded in.
 * @param {string} ringLogLevelStr is the level to log into the high performance rung buffer
 * @param {string} outputLogLevelStr is the level to log out to to stable storage
 * @param {*} logSink is the flag/file to write the log contents into undefined -> stdout, string -> file
 */
module.exports = function (name, lfilename, ringLogLevelStr, outputLogLevelStr, logSink) {
    let m_ringLogLevel = loggingLevels.LEVEL_OFF;
    let m_outputLogLevel = loggingLevels.LEVEL_OFF;
    for (let p in loggingLevels) {
        if (loggingLevels[p].name === ringLogLevelStr) {
            m_ringLogLevel = loggingLevels[p];
        }

        if (loggingLevels[p].name === outputLogLevelStr) {
            m_outputLogLevel = loggingLevels[p];
        }
    }

    if (m_ringLogLevel.enum < m_outputLogLevel.enum) {
        //have to at least put it in ring buffer if we want to output it
        m_ringLogLevel = m_outputLogLevel;
    }

    //Get the logging function to use for a given level
    let getLogFunctionForLevel = function (mname, level, checklevel) {
        return (level.enum <= checklevel.enum) ?
            function (fmt, msg) { console.log(`${fmt} + ${msg} -- from ${mname} level=${level.name}`); } :
            function (fmt, msg) { ; }
    };

    //inner function to do common initialization work
    let initializeLoggerGeneral = function (rlevel, olevel) {
        return {
            module_name: name,
            ring_level: rlevel,
            output_level: olevel,

            levels: loggingLevels, //Export the logging levels for the clients

            logFatal: getLogFunctionForLevel(name, loggingLevels.LEVEL_FATAL, rlevel),
            logError: getLogFunctionForLevel(name, loggingLevels.LEVEL_ERROR, rlevel),
            logCore: getLogFunctionForLevel(name, loggingLevels.LEVEL_CORE, rlevel),
            logWarn: getLogFunctionForLevel(name, loggingLevels.LEVEL_WARN, rlevel),
            logInfo: getLogFunctionForLevel(name, loggingLevels.LEVEL_INFO, rlevel),
            logDebug: getLogFunctionForLevel(name, loggingLevels.LEVEL_DEBUG, rlevel),
            logTrace: getLogFunctionForLevelTrace(name, loggingLevels.LEVEL_TRACE, rlevel),

            logSimple: function (msg) { console.log(`Direct: ${msg}`); },

            //Add formats in an object where the property name is the format name and the value is the format string
            addMsgFormats: function (formatObj) {
                for (let fmtName in formatObj) {
                    if (this[fmtName]) {
                        sanityAssert(false, 'Failed, trying to re-define a msg format.');
                        return false;
                    }

                    try {
                        let processedFmtInfo = extractMsgFormat(fmtName, formatObj[fmtName].format);

                        //invoke native registraion of msg format information
                        let fmtId = nativeLogRegisterMsgFormat(this, formatObj[fmtName].level.enum, fmtName, processedFmtInfo.format, processedFmtInfo.fmtArray);
                        sanityAssert(fmtId !== -1, "Failed in format operation.");

                        this[fmtName] = fmtId;
                    }
                    catch (ex) {
                        sanityAssert(false, 'Failed in load msg format');
                        return false;
                    }
                }
            }
        };
    };

    let buildAndRegisterSubLogger = function (minfo) {
        sanityAssert(minfo.rootLogger !== null, "Root should be registered first!!!");

        let rlevel = ringLogLevel;
        let olevel = outputLogLevel;
        if (!minfo.enabledSubLoggerNames(name)) {
            let rlevel = loggingLevels.LEVEL_CORE;
            let olevel = (outputLogLevel.enum < loggingLevels.LEVEL_FATAL.enum) ? outputLogLevel : loggingLevels.LEVEL_FATAL;
        }

        let logsub = initializeLoggerGeneral(rlevel, olevel);
        logsub.loggerRoot = minfo.rootLogger;

        return logsub;
    };

    let buildAndRegisterTopLevelLogger = function (minfo) {
        sanityAssert(minfo.rootLogger === null, "Should only be registered once!!!");

        //call native initialize
        nativeLogInitialize(name, ringLogLevel.enum, outputLogLevel.enum);

        let logroot = initializeLoggerGeneral(ringLogLevel, outputLogLevel);
        minfo.loggerMap.set(name, logroot);

        minfo.rootLogger = logroot;

        //we have set all key things so we can do some recursive requires now
        logroot.ip_addr = require('os').hostname();
        logroot.app_name = require.main.filename;
        logroot.callback_id = -1;
        logroot.request_id = -1;

        return logroot;
    };

    let logger = module.exports.loggerMap.get(name);
    if (!logger) {
        if (require.main.filename !== lfilename) {
            logger = buildAndRegisterSubLogger(module.exports);
        }
        else {
            logger = buildAndRegisterTopLevelLogger(module.exports);
        }

        module.exports.loggerMap.set(name, logger);
    }

    return logger;
}

//Setup some standard definitions that need to be globally accessible
module.exports.rootLogger = null; //Logger for the root module
module.exports.enabledSubLoggerNames = new Set(); //Set of module names that are enabled for sub-logging
module.exports.loggerMap = new Map(); //Map of the loggers created for various module names

//Add submodules which are allowed to log at higher levels (otherwise restricted to ERROR level and lower)
module.exports.enableSubloggers = function (subloggers) {
    subloggers.forEach(function (elem) {
        this.enableSubloggers.add(elem);
    });
}
