//-------------------------------------------------------------------------------------------------------
// Copyright (C) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE.txt file in the project root for full license information.
//-------------------------------------------------------------------------------------------------------

//This code implements a node module that uses native runtime support to implement ultra-low overhea logging.

////
//Valid expandos are:
//#ip_addr     -- ip address of the host
//#app_name    -- name of the root app
//#module_name -- name of the module
//#msg_name    -- name of the msg (what it was registered with)
//#walltime    -- wallclock timestamp
//#logicaltime -- logical timestamp (both event loop and invoke counts)
//#callback_id -- the current callback id
//#request_id  -- the current request id (for http requests)
//##           -- a literal #
//
//Valid format specifiers are:
//${p:b} -- a boolean value
//${p:n} -- a number
//${p:s} -- a string
//${p:o<d,l>} -- an object expanded up to d levels (deafult is 2) at most l items in any level (default is * for objects 128 for arrays)
//${p:a<d,l>} -- an array expanded up to d levels (deafult is 2) at most l items in any level (default is * for objects 128 for arrays)
//${p:g} -- general value (general format applied -- no array expansion, object depth of 2)
//$$ -- a literal $

//TODO: add date, currency, and arraybuffer formatting options

////

'use strict'

let sanityAssert = function (cond, msg) {
    if (!cond) {
        console.log(msg);
        exit(1);
    }
}

//Tag values indicating the kind of each entry in the native log
let FormatStringEntryTag =
    {
        Clear: 0x0,

        IP_ADDR: 0x1,
        APP_NAME: 0x2,
        MODULE_NAME: 0x3,
        MSG_NAME: 0x4,
        WALLTIME: 0x5,
        LOGICAL_TIME: 0x6,
        CALLBACK_ID: 0x7,
        REQUEST_ID: 0x8,
        LITERAL_HASH: 0x9,
        MAX_EXPANDO: LITERAL_HASH,

        BOOL_VAL: 0x100, //${p:b}
        NUMBER_VAL: 0x200, //${p:n}
        STRING_VAL: 0x300, //${p:s}
        OBJECT_VAL: 0x400, //${p:o<d,l>}
        ARRAY_VAL: 0x500, //${p:a<d,l>}
        GENERAL_VAL: 0x600, //${p:g}
        LITERAL_DOLLAR: 0x700, //$$
    };

//Extract a msg format string for registering a msg format with the native logger implementation
let extractMsgFormat = function (fmtName, fmtString) {
    let cpos = 0;
    let fmtArray = [];

    if (typeof (fmtName) !== 'string' || typeof (fmtString) !== 'string') {
        throw 'Name and Format need to be strings.'
    }

    //helper function to extract and construct an expando format specifier
    let extractExpandoSpecifier = function () {
        if (fmtString.startsWith('##', cpos)) {
            return { ftag: FormatStringEntryTag.LITERAL_HASH, fposition: -1, fstart: cpos, fend: cpos + '##'.length };
        }
        else if (fmtString.startsWith('#ip_addr', cpos)) {
            return { ftag: FormatStringEntryTag.IP_ADDR, fposition: -1, fstart: cpos, fend: cpos + '#ip_addr'.length };
        }
        else if (fmtString.startsWith('#app_name', cpos)) {
            return { ftag: FormatStringEntryTag.APP_NAME, fposition: -1, fstart: cpos, fend: cpos + '#app_name'.length };
        }
        else if (fmtString.startsWith('#module_name', cpos)) {
            return { ftag: FormatStringEntryTag.MODULE_NAME, fposition: -1, fstart: cpos, fend: cpos + '#module_name'.length };
        }
        else if (fmtString.startsWith('#msg_name', cpos)) {
            return { ftag: FormatStringEntryTag.MSG_NAME, fposition: -1, fstart: cpos, fend: cpos + '#msg_name'.length };
        }
        else if (fmtString.startsWith('#walltime', cpos)) {
            return { ftag: FormatStringEntryTag.WALLTIME, fposition: -1, fstart: cpos, fend: cpos + '#walltime'.length };
        }
        else if (fmtString.startsWith('#logicaltime', cpos)) {
            return { ftag: FormatStringEntryTag.LOGICAL_TIME, fposition: -1, fstart: cpos, fend: cpos + '#logicaltime'.length };
        }
        else if (fmtString.startsWith('#callback_id', cpos)) {
            return { ftag: FormatStringEntryTag.CALLBACK_ID, fposition: -1, fstart: cpos, fend: cpos + '#callback_id'.length };
        }
        else if (fmtString.startsWith('#request_id', cpos)) {
            return { ftag: FormatStringEntryTag.REQUEST_ID, fposition: -1, fstart: cpos, fend: cpos + '#request_id'.length };
        }
        else {
            throw "Bad match in expando format string.";
        }
    }

    //helper function to extract and construct an argument format specifier
    let extractArgumentFormatSpecifier = function () {
        if (fmtString.startsWith('$$', cpos)) {
            return { ftag: FormatStringEntryTag.LITERAL_DOLLAR, fposition: -1, fstart: cpos, fend: cpos + '$$'.length };
        }
        else {
            if (!fmtString.startsWith('${', cpos)) {
                throw "Stray '$' in argument formatter.";
            }

            let numberRegex = new RegExp("\d+", 'y');

            numberRegex.lastIndex = cpos + '${'.length;
            let argPositionMatch = numberRegex.exec(fmtString);
            if (!argPositionMatch) {
                throw "Bad position specifier in format."
            }

            let argPosition = Number.parseInt(argPositionMatch[0]);
            if (argPosition < 0) {
                throw "Bad position specifier in format."
            }

            let specPos = cpos + '${'.length + argPositionMatch[0].length;
            if (fmtString.startsWith(':b}', specPos)) {
                return { ftag: FormatStringEntryTag.BOOL_VAL, fposition: argPosition, fstart: cpos, fend: specPos + ':b}'.length };
            }
            else if (fmtString.startsWith(':n}', specPos)) {
                return { ftag: FormatStringEntryTag.NUMBER_VAL, fposition: argPosition, fstart: cpos, fend: specPos + ':n}'.length };
            }
            else if (fmtString.startsWith(':s}', specPos)) {
                return { ftag: FormatStringEntryTag.STRING_VAL, fposition: argPosition, fstart: cpos, fend: specPos + ':s}'.length };
            }
            else if (fmtString.startsWith(':g}', specPos)) {
                return { ftag: FormatStringEntryTag.GENERAL_VAL, fposition: argPosition, fstart: cpos, fend: specPos + ':g}'.length };
            }
            else {
                if (!fmtString.startsWith(':o', specPos) && !fmtString.startsWith(':a', specPos)) {
                    throw "Bad match in argument format string.";
                }

                let DEFAULT_DEPTH = 2;
                let DEFAULT_OBJECT_LENGTH = 1024;
                let DEFAULT_ARRAY_LENGTH = 128;
                let DL_STAR = 1073741824;

                if (fmtString.startsWith(':o}', specPos)) {
                    return { ftag: FormatStringEntryTag.OBJECT_VAL, fposition: argPosition, fstart: cpos, fend: specPos + ':o}'.length, fdepth: DEFAULT_DEPTH, flength: DEFAULT_OBJECT_LENGTH };
                }
                else if (fmtString.startsWith(':a}', specPos)) {
                    return { ftag: FormatStringEntryTag.ARRAY_VAL, fposition: argPosition, fstart: cpos, fend: specPos + ':a}'.length, fdepth: DEFAULT_DEPTH, flength: DEFAULT_ARRAY_LENGTH };
                }
                else {
                    let dlRegex = new RegExp(":([o|a])<(\d+|*)?,(\d+|*)?>", 'y');
                    dlRegex.lastIndex = specPos;

                    let dlMatch = dlRegex.exec(fmtString);
                    if (!dlMatch) {
                        throw "Bad position specifier in format."
                    }

                    let ttag = (dlMatch[1] === ':o') ? FormatStringEntryTag.OBJECT_VAL : FormatStringEntryTag.ARRAY_VAL;
                    let tdepth = DEFAULT_DEPTH;
                    let tlength = (dlMatch[1] === ':o') ? DEFAULT_OBJECT_LENGTH : DEFAULT_ARRAY_LENGTH;

                    if (dlMatch[2] !== '') {
                        tdepth = (dlMatch[2] !== '*') ? Number.parseInt(dlMatch[2]) : DL_STAR;
                    }

                    if (dlMatch[3] !== '') {
                        tlength = (dlMatch[3] !== '*') ? Number.parseInt(dlMatch[3]) : DL_STAR;
                    }

                    return { ftag: ttag, fposition: argPosition, fstart: cpos, fend: specPos + dlMatch[0].length, fdepth: tdepth, flength: tlength };
                }
            }
        }
    }

    while (cpos < fmtString.length) {
        if (fmtString[cpos] !== '#' && fmtString[cpos] !== '$') {
            cpos++;
        }
        else {
            let fmt = (fmtString[cpos] === '#') ? extractExpandoSpecifier() : extractArgumentFormatSpecifier();
            fmtArray.push(fmt);

            cpos = fmt.fend;
        }
    }
}

//Setup some standard definitions that need to be globally accessible
module.exports.rootLogger = null; //Logger for the root module
module.exports.enabledSubLoggerNames = new Set(); //Set of module names that are enabled for sub-logging
module.exports.loggerMap = new Map(); //Map of the loggers created for various module names

let loggingLevels =
    {
        LEVEL_OFF: 0x0,
        LEVEL_FATAL: (LEVEL_OFF | 0x1),
        LEVEL_ERROR: (LEVEL_FATAL | 0x2),
        LEVEL_CORE: (LEVEL_ERROR | 0x4),
        LEVEL_WARN: (LEVEL_CORE | 0x8),
        LEVEL_INFO: (LEVEL_WARN | 0x10),
        LEVEL_DEBUG: (LEVEL_INFO | 0x20),
        LEVEL_TRACE: (LEVEL_DEBUG | 0x40),
        LEVEL_ALL: (LEVEL_TRACE | 0xFF)
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

            //Add formats in an object where the property name is the format name and the value is the format string
            addMsgFormats: function (formatObj) {
                for (let fmtName in formatObj) {
                    if(this[fmtName]) {
                        sanityAssert(false, 'Failed, trying to re-define a msg format.');
                        return false;
                    }

                    try {
                        let fmtObj = extractMsgFormat(fmtName, formatObj[fmtName]);
                        let fmtId = -1; //<----- this is where we call into the native runtime to register and get the Id

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
