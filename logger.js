//-------------------------------------------------------------------------------------------------------
// Copyright (C) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//-------------------------------------------------------------------------------------------------------

//This code implements a node module that uses native runtime support to implement ultra-low overhea logging.

'use strict'

let sanityAssert = function (cond, msg) {
    if (!cond) {
        console.log(msg);
        exit(1);
    }
}

//Setup some standard definitions that need to be globally accessible
module.exports.rootLogger = null; //Logger for the root module
module.exports.enabledSubLoggerNames = new Set(); //Set of module names that are enabled for sub-logging
module.exports.loggerMap = new Map(); //Map of the loggers created for various module names

let loggingLevels =
    {
        LEVEL_OFF:   0x0,
        LEVEL_FATAL: (LEVEL_OFF   | 0x1),
        LEVEL_ERROR: (LEVEL_FATAL | 0x2),
        LEVEL_CORE:  (LEVEL_ERROR | 0x4),
        LEVEL_WARN:  (LEVEL_CORE  | 0x8),
        LEVEL_INFO:  (LEVEL_WARN  | 0x10),
        LEVEL_DEBUG: (LEVEL_INFO  | 0x20),
        LEVEL_TRACE: (LEVEL_DEBUG | 0x40),
        LEVEL_ALL:   (LEVEL_TRACE | 0xFF)
    };

module.exports.registerLogger = function (name, ringLogLevel, outputLogLevel) {
    if (ringLogLevel < outputLogLevel) {
        //have to at least put it in ring buffer if we want to output it
        ringLogLevel = outputLogLevel;
    }

    //Get the logging function to use for a given level
    let getLogFunctionForLevel = function (level, checklevel) {
        return (level <= checklevel) ?
            function (fmt, msg) { console.log(`${fmt} + ${msg} -- from ${this.module_name} level=${level}`); } :
            function (fmt, msg) { ; }
    };

    //inner function to do common initialization work
    let initializeLoggerGeneral = function (rlevel, olevel) {
        return {
            module_name: name,
            ring_level: rlevel,
            output_level: olevel,

            logFatal: getLogFunctionForLevel(loggingLevels.LEVEL_FATAL, rlevel),
            logError: getLogFunctionForLevel(loggingLevels.LEVEL_ERROR, rlevel),
            logCore: getLogFunctionForLevel(loggingLevels.LEVEL_CORE, rlevel),
            logWarn: getLogFunctionForLevel(loggingLevels.LEVEL_WARN, rlevel),
            logInfo: getLogFunctionForLevel(loggingLevels.LEVEL_INFO, rlevel),
            logDebug: getLogFunctionForLevel(loggingLevels.LEVEL_DEBUG, rlevel),
            logTrace: getLogFunctionForLevel(loggingLevels.LEVEL_TRACE, rlevel),

            logSimple: function (msg) { console.log(`Direct: ${msg}`); },

            addMsgFormats: function (msgName, formatString) {
                asdf; //<----------------------------------------------- continue working here!!!
            }
        };
    };

    let buildAndRegisterSubLogger = function () {
        sanityAssert(this.rootLogger !== null, "Root should be registered first!!!");

        let rlevel = this.enabledSubLoggerNames(name) ? ringLogLevel : loggingLevels.LEVEL_CORE;
        let olevel = this.enabledSubLoggerNames(name) ? outputLogLevel : min(outputLogLevel, loggingLevels.LEVEL_FATAL);

        let logsub = initializeLoggerGeneral(rlevel, olevel);
        logsub.loggerRoot = this.rootLogger;

        return logsub;
    };

    let buildAndRegisterTopLevelLogger = function () {
        sanityAssert(this.rootLogger === null, "Should only be registered once!!!");

        let logroot = initializeLoggerGeneral(ringLogLevel, outputLogLevel);
        this.loggerMap.set(name, logroot);

        this.rootLogger = logroot;

        //we have set all key things so we can do some recursive requires now
        logroot.ip_addr = require('os').hostname();
        logroot.app_name = require.main.filename;
        logroot.callback_id = -1;
        logroot.request_id = -1;

        return logroot;
    };

    let logger = this.loggerMap.get(name);
    if (!logger) {
        if (require.main !== module) {
            logger = buildAndRegisterSubLogger();
        }
        else {
            logger = buildAndRegisterTopLevelLogger();
        }

        this.loggerMap.set(name, logger);
    }

    return logger;
}

//Add submodules which are allowed to log at higher levels (otherwise restricted to ERROR level and lower)
module.exports.enableSubloggers = function (subloggers) {
    subloggers.forEach(function (elem) {
        this.enableSubloggers.add(elem);
    });
}
