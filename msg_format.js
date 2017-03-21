/*
* This module provides the representation of our msg formats and provides 
* functionality for converting strings or objects into the format.
*/

////
//Valid expandos are:
//#ip_addr     -- ip address of the host
//#app_name    -- name of the root app
//#module_name -- name of the module
//#msg_name    -- name of the msg (what it was registered with)
//#wall_time    -- wallclock timestamp
//#logical_time -- logical timestamp
//#callback_id -- the current callback id
//#request_id  -- the current request id (for http requests)
//##           -- a literal #
//
//Valid format specifiers are:
//${p:b} -- a boolean value
//${p:n} -- a number
//${p:s} -- a string
//${p:o<d,l>} -- an object expanded up to d levels (default is 2) at most l items in any level (default is * for objects 128 for arrays)
//${p:a<d,l>} -- an array expanded up to d levels (default is 2) at most l items in any level (default is * for objects 128 for arrays)
//${p:g} -- general value (general format applied -- no array expansion, object depth of 2)
//$$ -- a literal $

//TODO: add date, currency, and arraybuffer formatting options

////

'use strict';

/**
 * Tag values for logging levels.
 * @exports
 */
exports.LoggingLevels = {
    OFF: { label: 'OFF', enum: 0x0 },
    FATAL: { label: 'FATAL', enum: 0x1 },
    ERROR: { label: 'ERROR', enum: 0x3 },
    WARN: { label: 'WARN', enum: 0x7 },
    INFO: { label: 'INFO', enum: 0xF },
    DEBUG: { label: 'DEBUG', enum: 0x1F },
    TRACE: { label: 'TRACE', enum: 0x3F },
    ALL: { label: 'ALL', enum: 0xFF }
};

/**
 * Tag values for system info logging levels.
 * @exports
 */
exports.SystemInfoLevels = {
    OFF: { label: 'OFF', enum: 0x0 },
    REQUEST: { label: 'REQUEST', enum: 0x100 },
    ASYNC: { label: 'ASYNC', enum: 0x300 },
    ALL: { label: 'ALL', enum: 0xF00 }
};

/////////////////////////////
//Generally useful code

/**
* Check if an object is a nice literal object (more or less) 
* @function
* @param {*} arg 
* @return {boolean} 
*/
function isSimpleObject(arg) {
    if (arg === null || arg === undefined || typeof (arg) !== 'object') {
        return false;
    }

    return (typeof (Object.getPrototypeOf(arg)) === 'object'); //not perfect but simple enough
}

/////////////////////////////
//Code for manipulating message format representations

/**
 * Tag values indicating the kind of each entry in the native log.
 */
FormatStringEntryTag = {
    Clear: { label: 'clear', enum: 0x0 },

    LITERAL_HASH: { label: '#', enum: 0x2 },
    IP_ADDR: { label: '#ip_addr', enum: 0x3 },
    APP_NAME: { label: '#app_name', enum: 0x4 },
    MODULE_NAME: { label: '#module_name', enum: 0x5 },
    MSG_NAME: { label: '#msg_name', enum: 0x6 },
    WALLTIME: { label: '#wall_time', enum: 0x7 },
    LOGICAL_TIME: { label: '#logical_time', enum: 0x8 },
    CALLBACK_ID: { label: '#callback_id', enum: 0x9 },
    REQUEST_ID: { label: '#request_id', enum: 0xa },

    LITERAL_DOLLAR: { label: '$', enum: 0x200 }, //$$
    BOOL_VAL: { label: 'b', enum: 0x300 }, //${p:b}
    NUMBER_VAL: { label: 'n', enum: 0x400 }, //${p:n}
    STRING_VAL: { label: 's', enum: 0x500 }, //${p:s}
    GENERAL_VAL: { label: 'g', enum: 0x600 }, //${p:g}
    OBJECT_VAL: { label: 'o', enum: 0x700 }, //${p:o<d,l>}
    ARRAY_VAL: { label: 'a', enum: 0x800 }, //${p:a<d,l>}
};

let s_expandoEntries = Object.keys(FormatStringEntryTag)
    .filter(function (value) { return FormatStringEntryTag.IP_ADDR.enum <= value.enum && value.enum <= FormatStringEntryTag.REQUEST_ID.enum; })
    .map(function (value) { return FormatStringEntryTag[value]; });

let s_basicFormatEntries = Object.keys(FormatStringEntryTag)
    .filter(function (value) { return FormatStringEntryTag.BOOL_VAL.enum <= value.enum && value.enum <= FormatStringEntryTag.GENERAL_VAL.enum; })
    .map(function (value) { return FormatStringEntryTag[value]; });

let s_compoundFormatEntries = Object.keys(FormatStringEntryTag)
    .filter(function (value) { return FormatStringEntryTag.OBJECT_VAL.enum <= value.enum && value.enum < FormatStringEntryTag.ARRAY_VAL.enum; })
    .map(function (value) { return FormatStringEntryTag[value].label; });

let s_expandoStringRe = new RegExp('^('
    + s_expandoEntries
        .map(function (value) { return FormatStringEntryTag[value].label; })
        .join('|')
    + ')$');

let s_basicFormatStringRe = new RegExp('^\\${(\\d+):('
    + s_basicFormatEntries
        .map(function (value) { return FormatStringEntryTag[value].label; })
        .join('|')
    + ')}$');

let s_compoundFormatStringRe = new RegExp('^\\${(\\d+):('
    + s_compoundFormatEntries
        .map(function (value) { return FormatStringEntryTag[value].label; })
        .join('|')
    + ')(<(\\d+|\\*)?,(\\d+|\\*)?>}$');

/**
 * Construct a msgFormat entry for an expando.
 * @function
 * @param {Object} formatTag a tag from FormatStringEntryTag
 * @param {number} formatStringStart where the formatter starts in the format string
 * @param {number} formatStringEnd where the formatter string ends -- entry is range [formatStringStart, formatStringEnd)
 */
function msgFormat_CreateExpando(formatTag, formatStringStart, formatStringEnd) {
    return { format: formatTag, formatStart: formatStringStart, formatEnd: formatStringEnd };
}

/**
 * Construct a msgFormat entry for a simple formatter.
 * @function
 * @param {Object} formatTag a tag from FormatStringEntryTag
 * @param {number} argListPosition the position of the format arg in the arglist
 * @param {number} formatStringStart where the formatter starts in the format string
 * @param {number} formatStringEnd where the formatter string ends -- entry is range [formatStringStart, formatStringEnd)
 */
function msgFormat_CreateBasicFormatter(formatTag, argListPosition, formatStringStart, formatStringEnd) {
    return { format: formatTag, argPosition: argListPosition, formatStart: formatStringStart, formatEnd: formatStringEnd };
}

/**
 * Construct a msgFormat entry for a compound formatter.
 * @function
 * @param {Object} formatTag a tag from FormatStringEntryTag
 * @param {number} argListPosition the position of the format arg in the arglist
 * @param {number} formatStringStart where the formatter starts in the format string
 * @param {number} formatStringEnd where the formatter string ends -- entry is range [formatStringStart, formatStringEnd)
 * @param {number} formatExpandDepth object expansion depth
 * @param {number} formatExpandLength object expansion length
 */
function msgFormat_CreateCompundFormatter(formatTag, argListPosition, formatStringStart, formatStringEnd, formatExpandDepth, formatExpandLength) {
    return { format: formatTag, argPosition: argListPosition, formatStart: formatStringStart, formatEnd: formatStringEnd, expandDepth: formatExpandDepth, expandLength: formatExpandLength };
}

/**
 * Take an array or object literal format representation and convert it to json string format representation.
 * @function
 * @param {*} jobj 
 * @return {string}
 */
function msgFormat_expandToJsonFormatter(jobj) {
    if (jobj === undefined || jobj === null || jobj === true || jobj === false) {
        return JSON.stringify(jobj);
    }
    else if (typeof (jobj) === 'number') {
        return JSON.stringify(jobj);
    }
    else if (typeof (jobj) === 'string') {
        if (s_expandoStringRe.test(jobj) || s_basicFormatStringRe.test(jobj) || s_compoundFormatStringRe.test(jobj)) {
            return jobj;
        }
        else {
            return '"' + jobj + '"';
        }
    }
    else if (Array.isArray(jobj)) {
        return '[ '
            + jobj
                .map(function (value) { return msgFormat_expandToJsonFormatter(value); })
                .join(', ')
            + ' ]';
    }
    else if (isSimpleObject(jobj)) {
        return '{ '
            + Object.keys(jobj)
                .map(function (key) { return '"' + key + '"' + ': ' + msgFormat_expandToJsonFormatter(jobj[key]); })
                .join(', ')
            + ' }';
    }
    else {
        return '"' + jobj.toString() + '"';
    }
}

/**
 * Helper function to extract and construct an expando format specifier or throws is the expando is malformed
 * @function
 * @param {string} fmtString
 * @param {number} vpos
 * @returns {Object} format specifier object
 */
function msgFormat_extractExpandoSpecifier(fmtString, vpos) {
    if (fmtString.startsWith('##', vpos)) {
        return msgFormat_CreateExpando(FormatStringEntryTag.LITERAL_HASH, vpos, vpos + '##'.length);
    }
    else {
        let expando = s_expandoEntries.find(function (expando) { return fmtString.startsWith(expando.label); });
        if (!expando) {
            throw new Error("Bad match in expando format string.");
        }

        return msgFormat_CreateExpando(expando, vpos, vpos + expando.label.length);
    }
}

/**
 * Helper function to extract and construct an argument format specifier or throws is the format specifier is malformed.
 * @function
 * @param {string} fmtString
 * @param {number} vpos
 * @returns {Object} format specifier object
 */
function msgFormat_extractArgumentFormatSpecifier(fmtString, vpos) {
    if (fmtString.startsWith('$$', vpos)) {
        return msgFormat_CreateBasicFormatter(FormatStringEntryTag.LITERAL_DOLLAR, -1, vpos, vpos + '$$'.length);
    }
    else {
        if (!fmtString.startsWith('${', vpos)) {
            throw new Error("Stray '$' in argument formatter.");
        }

        let numberRegex = /\d+/y;
        numberRegex.lastIndex = vpos + '${'.length;

        let argPositionMatch = numberRegex.exec(fmtString);
        if (!argPositionMatch) {
            throw new Error("Bad position specifier in format.");
        }

        let argPosition = Number.parseInt(argPositionMatch[0]);
        if (argPosition < 0) {
            throw new Error("Bad position specifier in format.");
        }

        let specPos = vpos + '${'.length + argPositionMatch[0].length;
        if (fmtString.charAt(specPos) !== ':') {
            throw new Error("Bad position specifier in format.");
        }
        specPos++;

        let cchar = fmtString.charAt(specPos);
        let basicFormatOption = s_basicFormatEntries.find(function (value) { return value.label === cchar; });
        let compoundFormatOption = s_compoundFormatInfo.find(function (value) { return value.label === cchar; });

        if (!basicFormatOption && !compoundFormatOption) {
            throw new Error("Bad format specifier kind.");
        }

        if (basicFormatOption) {
            let fendpos = specPos + 2; //"x}".length
            return msgFormat_CreateBasicFormatter(basicFormatOption, argPosition, vpos, fendpos);
        }
        else {
            let DEFAULT_DEPTH = 2;
            let DEFAULT_OBJECT_LENGTH = 1024;
            let DEFAULT_ARRAY_LENGTH = 128;
            let DL_STAR = 1073741824;

            if (fmtString.startsWith('o}', specPos)) {
                return msgFormat_CreateCompundFormatter(FormatStringEntryTag.OBJECT_VAL, argPosition, vpos, specPos + 'o}'.length, DEFAULT_DEPTH, DEFAULT_OBJECT_LENGTH);
            }
            else if (fmtString.startsWith('a}', specPos)) {
                return msgFormat_CreateCompundFormatter(FormatStringEntryTag.ARRAY_VAL, argPosition, vpos, specPos + 'a}'.length, DEFAULT_DEPTH, DEFAULT_ARRAY_LENGTH);
            }
            else {
                let dlRegex = /([o|a])<(\d+|\*)?,(\d+|\*)?>/y;
                dlRegex.lastIndex = specPos;

                let dlMatch = dlRegex.exec(fmtString);
                if (!dlMatch) {
                    throw new Error("Bad position specifier in format.");
                }

                let ttag = (dlMatch[1] === 'o') ? FormatStringEntryTag.OBJECT_VAL : FormatStringEntryTag.ARRAY_VAL;
                let tdepth = DEFAULT_DEPTH;
                let tlength = (dlMatch[1] === 'o') ? DEFAULT_OBJECT_LENGTH : DEFAULT_ARRAY_LENGTH;

                if (dlMatch[2] !== '') {
                    tdepth = (dlMatch[2] !== '*') ? Number.parseInt(dlMatch[2]) : DL_STAR;
                }

                if (dlMatch[3] !== '') {
                    tlength = (dlMatch[3] !== '*') ? Number.parseInt(dlMatch[3]) : DL_STAR;
                }

                return msgFormat_CreateCompundFormatter(ttag, argPosition, vpos, specPos + dlMatch[0].length, tdepth, tlength);
            }
        }
    }
}


/**
 * Construct a msgFormat object.
 * @function
 * @param {string} fmtName is the name given to the format message
 * @param {string} fmtString the format string 
 * @param {number} maxArgPos the largest argument index used in the format message
 * @param {Array} fmtEntryArray the array of msgFormat entries (expandos and format strings) used
 */
function msgFormat_Create(fmtName, fmtString, maxArgPos, fmtEntryArray) {
    return { formatName: fmtName, formatString: fmtString, maxArgPosition: maxArgPos, formatterArray: fmtEntryArray };
}

/**
 * Takes a message format string and converts it to our internal format structure.
 * @function
 * @param {string} fmtName The name of the format string.
 * @param {*} fmtInfo The format string | a literal JSON format object/array
 * @throws If the format is ill-defined we throw an error.
 * @returns {Object} The format structure object 
 */
exports.extractMsgFormat = function (fmtName, fmtInfo) {
    let cpos = 0;

    if (typeof (fmtName) !== 'string') {
        throw 'Name needs to be a string.'
    }

    let fmtString = undefined;
    if (typeof (fmtInfo) === 'string') {
        fmtString = fmtInfo;
    }
    else {
        if (!Array.isArray(fmtInfo) && !isSimpleObject(fmtInfo)) {
            throw new Error('Format description options are string | object layout | array layout.');
        }

        fmtString = msgFormat_expandToJsonFormatter(fmtInfo);
    }

    let newlineRegex = /(\n|\r)/
    if (newlineRegex.test(fmtString)) {
        throw new Error('Format cannot contain newlines.');
    }

    let fArray = [];
    let maxArgPos = 0;
    while (cpos < fmtString.length) {
        let cchar = fmtString.charAt(cpos);
        if (cchar !== '#' && cchar !== '$') {
            cpos++;
        }
        else {
            let fmt = (cchar === '#') ? msgFormat_extractExpandoSpecifier(fmtString, cpos) : msgFormat_extractArgumentFormatSpecifier(fmtString, cpos);
            fArray.push(fmt);

            if (fmt.fposition) {
                maxArgPos = Math.max(maxArgPos, fmt.fposition);
            }

            cpos = fmt.fend;
        }
    }

    return msgFormat_Create(fmtName, fmtString, maxArgPos, fArray);
}

/////////////////////////////
//Code for representing the log messages in the low overhead in memory-ring buffer and moving them into/out of this structure

/**
 * Tag values indicating the kind of each entry in the fast log buffer
 */
let LogEntryTags = {
    Clear: 0x0,
    
    MsgFormat: 0x10,     //The var is pointer to the formatInfo object
    MsgLevel: 0x20,      //The var is a tagged int of a logger level
    LParen: 0x30,
    RParen: 0x40,
    LBrack: 0x50,
    RBrack: 0x60,
    PropertyRecord: 0x70,  //The entry contains a property record

    JsBadFormatVar: 0x100, //The var is undefined due to an argument that did not match the format specifier
    JsVarValue: 0x200,     //The var is a regular value 

    LengthBoundHit: 0x300,
    FormatErrorHit: 0x400,

    CycleValue: 0x500,
    OpaqueValue: 0x600,
    OpaqueObject: 0x700,
    OpaqueArray: 0x800,

    Max: 0x1000
};

/**
 * When we are emitting we can be in multiple modes (formatting, objects, arrays, etc.) so we want tags (used below to indicate)
 */
let EmitMode = {
    Clear: 0x0,
    TopLevelMode: 0x1,
    SpanMessage: 0x2,
    MsgFormat: 0x3,
    ObjectMode: 0x4,
    ArrayMode: 0x5
};

/**
 * The number of entries we have in a msg block.
 */
const s_msgBlockSize = 1024;

/**
 * A helper function to allocate a new block of messages.
 */
function msgBlock_Create(previousBlock) {
    let nblock = {
        //number of slots used
        count: 0,

        //arrays holding the tag and entry data 
        tags: new Uint8Array(s_msgBlockSize),
        data: new Array(s_msgBlockSize),

        //DLL next/previous
        next: null,
        previous: (previousBlock ? previousBlock : null)
    };

    if (previousBlock) {
        previousBlock.next = nblock;
    }

    return nblock;
}

/**
 * A helper function to create a blocklist
 */
function msgBlock_CreateBlockList() {
    let iblock = createMsgBlock(null);

    return {
        head: iblock,
        tail: iblock,
        jsonCycleMap: new Set()
    };
}

/**
 * A helper ensure we can write several entries to a block without allocating
 */
function msgBlock_EnsureDataSlots(blockList, size) {
    if (blockList.tail.count + size >= s_msgBlockSize) {
        let nblock = createMsgBlock(block);
        blockList.tail = nblock;
    }
}

/**
 * A helper function to add an entry to a block list
 */
function msgBlock_AddEntryToMsgBlock(blockList, tag, data) {
    if (blockList.tail.count === s_msgBlockSize) {
        let nblock = createMsgBlock(block);
        blockList.tail = nblock;
    }

    let block = blockList.tail;
    block.tags[block.count] = tag;
    block.data[block.count] = data;
    block.count++;
}

/**
 * A helper function to add an entry to a block list
 */
function msgBlock_AddEntryToMsgBlockUnchecked(blockList, tag, data) {
    let block = blockList.tail;
    block.tags[block.count] = tag;
    block.data[block.count] = data;
    block.count++;
}

/**
 * Log a message into the logger -- throw if we have any formatting style errors
 */
exports.LogMessage = function (blockList, macroInfo, level, fmt, argc, args) {
    ensureDataSlots(blockList, 3);
    addEntryToMsgBlockUnchecked(blockList, LogEntryTags.FormattedMsg, undefined);
    addEntryToMsgBlockUnchecked(blockList, LogEntryTags.MsgFormat, fmt);
    addEntryToMsgBlockUnchecked(blockList, LogEntryTags.MsgLevel, level);

    try {
        for (let i = 0; i < fmt.formatterArray.length; ++i) {
            assert(blockList.jsonCycleMap.size === 0, "Should always be emptied after processing an object/array.");

            let fentry = fmt.formatterArray[i];

asdf---

            let value = (fentry.fposition !== -1 && fentry.fposition < argc) ? args[fentry.fposition] : undefined;

            switch (fentry.ftag) {
                case FormatStringEntryTag.IP_ADDR:
                asdf;
                break;
                case FormatStringEntryTag.APP_NAME:
                asdf;
                break;
                case FormatStringEntryTag.MODULE_NAME:
                addEntryToMsgBlock(blockList, fentry.ftag, macroInfo[fentry.ftag]);
                break;
                case FormatStringEntryTag::MSG_NAME:

                    this ->AddArg(LogEntryTag::JsVarValue, name, Js::JavascriptOperators::GetTypeId(name));

                    break;

                case FormatStringEntryTag::WALLTIME:

                    this ->AddLogArgFromDouble(LogEntryTag::JsVarValue, this ->m_timer.Now(), ctx);

                    break;

                case FormatStringEntryTag::LOGICAL_TIME:

                    this ->AddLogArgFromUInt64(LogEntryTag::JsVarValue, this ->m_logicalTime, ctx);

                    break;

                case FormatStringEntryTag::CALLBACK_ID:

                    this ->AddLogArgFromRootInfoObj(loggerInfoObj, _u("callback_id"));

                    break;

                case FormatStringEntryTag::REQUEST_ID:

                    this ->AddLogArgFromRootInfoObj(loggerInfoObj, _u("request_id"));

                    break;

                case FormatStringEntryTag::BOOL_VAL:

                    fmtok &= this ->AddLogArgAsBool(value, ctx);

                    break;

                case FormatStringEntryTag::NUMBER_VAL:

                    fmtok &= this ->AddLogArgAsNumber(value, ctx);

                    break;

                case FormatStringEntryTag::STRING_VAL:
                    fmtok &= this ->AddLogArgAsString(value, ctx);

                    break;
                case FormatStringEntryTag::OBJECT_VAL:
                    fmtok &= this ->AddLogArgAsObject(value, ctx, fentry.Depth, fentry.Length);

                    this ->m_jsonCycleDetectionMap.Clear();

                    break;
                case FormatStringEntryTag::ARRAY_VAL:
                    fmtok &= this ->AddLogArgAsArray(value, ctx, fentry.Depth, fentry.Length);

                    this ->m_jsonCycleDetectionMap.Clear();

                    break;
                case FormatStringEntryTag::GENERAL_VAL:
                    this ->AddGeneralValue_Internal(value, ctx, NATIVE_LOGGER_DEFAULT_EXPAND_DEPTH); //format is always ok -- tag gets updated to match value kind

                    this ->m_jsonCycleDetectionMap.Clear();
                    break;
                default:
                    throw Error('We hit an unknown format tag: ' + fentry.ftag);
                    break;
            }
        }
    } catch (ex) {
        //If we had a format error place that as the value immediately following the data
        addEntryToMsgBlock(blockList, LogEntryTag.FormatErrorHit, ex);
    }
}