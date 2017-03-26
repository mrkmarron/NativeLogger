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

//TODO: remove asserts later
const assert = require('assert');

/**
 * Tag values for logging levels.
 */
const LoggingLevels = {
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
 * Tag values for system info logging levels
 */
const SystemInfoLevels = {
    OFF: { label: 'OFF', enum: 0x0 },
    REQUEST: { label: 'REQUEST', enum: 0x100 }, // if enabled written into the log at INFO level.
    ASYNC: { label: 'ASYNC', enum: 0x300 }, // if enabled written into the log at DEBUG level.
    ALL: { label: 'ALL', enum: 0xF00 }
};

//Default values we expand objects and arrays to
const DEFAULT_EXPAND_DEPTH = 2;
const DEFAULT_EXPAND_OBJECT_LENGTH = 1024;
const DEFAULT_EXPAND_ARRAY_LENGTH = 128;

/////////////////////////////
//Generally useful code
const TypeNameEnum_Undefined = 1;
const TypeNameEnum_Null = 2;
const TypeNameEnum_Boolean = 3;
const TypeNameEnum_Number = 4;

const TypeNameEnum_String = 5;
const TypeNameEnum_Date = 6;
const TypeNameEnum_Function = 7;

const TypeNameEnum_Object = 8;
const TypeNameEnum_JsArray = 9;
const TypeNameEnum_TypedArray = 10;

const TypeNameEnum_Unknown = 11;
const TypeNameEnum_Limit = 12;

////
//Useful cutoffs for TypeNameEnums
const TypeNameEnum_LastPrimitiveType = TypeNameEnum_Number;
const TypeNameEnum_LastSimpleType = TypeNameEnum_String;

const TypeNameToFlagEnum = {
    '[object Undefined]': TypeNameEnum_Undefined,
    '[object Null]': TypeNameEnum_Null,
    '[object Boolean]': TypeNameEnum_Boolean,
    '[object Number]': TypeNameEnum_Number,
    '[object String]': TypeNameEnum_String,
    '[object Date]': TypeNameEnum_Date,
    '[object Function]': TypeNameEnum_Function,
    '[object Object]': TypeNameEnum_Object,
    '[object Array]': TypeNameEnum_JsArray,
    '[object Float32Array]': TypeNameEnum_TypedArray,
    '[object Float64Array]': TypeNameEnum_TypedArray,
    '[object Int8Array]': TypeNameEnum_TypedArray,
    '[object Int16Array]': TypeNameEnum_TypedArray,
    '[object Int32Array]': TypeNameEnum_TypedArray,
    '[object Uint8Array]': TypeNameEnum_TypedArray,
    '[object Uint16Array]': TypeNameEnum_TypedArray,
    '[object Uint32Array]': TypeNameEnum_TypedArray
};

/**
 * Get the enumeration tag for the type of value
 * @function
 * @param {*} value 
 * @return {number} 
 */
function typeGetIdTag(value) {
    return TypeNameToFlagEnum[toString.call(value)] || TypeNameEnum_Unknown;
}

/////////////////////////////
//Code for manipulating message format representations

/**
 * Tag values indicating the kind of each format entry
 */
const FormatStringEntryKind_Literal = 1;
const FormatStringEntryKind_Expando = 2;
const FormatStringEntryKind_Basic = 3;
const FormatStringEntryKind_Compound = 4;

/**
 * Create a format string entry
 * @function
 * @param {string} name the name to use in the macroInfo object when extracting
 * @param {number} kind the FormatStringEntryKind_X tag
 * @param {string} label the string label that appears in a format string
 * @param {number} tag a unique incremented tag for fast integer compare
 * @param {bool} isSingleSlot true if this format is always stored in a single slot
 */
function generateSingletonFormatStringEntry(name, kind, label, tag, isSingleSlot) {
    return { name: name, kind: kind, label: label, enum: tag, isSingleSlot: isSingleSlot };
}

/**
 * Object singletons for format entries
 */
const FormatStringEntrySingletons = {
    LITERAL_HASH: generateSingletonFormatStringEntry('LITERAL_HASH', FormatStringEntryKind_Literal, '#', 1, true),
    IP_ADDR: generateSingletonFormatStringEntry('IP_ADDR', FormatStringEntryKind_Expando, '#ip_addr', 2, true),
    APP_NAME: generateSingletonFormatStringEntry('APP_NAME', FormatStringEntryKind_Expando, '#app_name', 3, true),
    MODULE_NAME: generateSingletonFormatStringEntry('MODULE_NAME', FormatStringEntryKind_Expando, '#module_name', 4, true),
    LOGICAL_TIME: generateSingletonFormatStringEntry('LOGICAL_TIME', FormatStringEntryKind_Expando, '#logical_time', 5, true),
    CALLBACK_ID: generateSingletonFormatStringEntry('CALLBACK_ID', FormatStringEntryKind_Expando, '#callback_id', 6, true),
    REQUEST_ID: generateSingletonFormatStringEntry('REQUEST_ID', FormatStringEntryKind_Expando, '#request_id', 7, true),

    MSG_NAME: generateSingletonFormatStringEntry('MSG_NAME', FormatStringEntryKind_Expando, '#msg_name', 8, true),
    WALLTIME: generateSingletonFormatStringEntry('WALL_TIME', FormatStringEntryKind_Expando, '#wall_time', 9, true),

    LITERAL_DOLLAR: generateSingletonFormatStringEntry('LITERAL_DOLLAR', FormatStringEntryKind_Literal, '$', 10, true),
    BOOL_VAL: generateSingletonFormatStringEntry('BOOL_VAL', FormatStringEntryKind_Basic, 'b', 11, true), //${p:b}
    NUMBER_VAL: generateSingletonFormatStringEntry('NUMBER_VAL', FormatStringEntryKind_Basic, 'n', 12, true), //${p:n}
    STRING_VAL: generateSingletonFormatStringEntry('STRING_VAL', FormatStringEntryKind_Basic, 's', 13, true), //${p:s}
    GENERAL_VAL: generateSingletonFormatStringEntry('GENERAL_VAL', FormatStringEntryKind_Basic, 'g', 14, false), //${p:g}
    OBJECT_VAL: generateSingletonFormatStringEntry('OBJECT_VAL', FormatStringEntryKind_Compound, 'o', 15, false), //${p:o<d,l>}
    ARRAY_VAL: generateSingletonFormatStringEntry('ARRAY_VAL', FormatStringEntryKind_Compound, 'a', 16, false) //${p:a<d,l>}
};

const FormatStringEntrySingleton_LastMacroInfoExpandoEnum = FormatStringEntrySingletons.REQUEST_ID.enum;
const FormatStringEntrySingleton_LastBasicFormatterEnum = FormatStringEntrySingletons.STRING_VAL.enum;
const FormatStringEntrySingleton_EnumLimit = FormatStringEntrySingletons.STRING_VAL.enum + 1;

const s_expandoEntries = Object.keys(FormatStringEntrySingletons)
    .filter(function (value) { return FormatStringEntrySingletons[value].kind === FormatStringEntryKind_Expando; })
    .map(function (value) { return FormatStringEntrySingletons[value]; });

const s_basicFormatEntries = Object.keys(FormatStringEntrySingletons)
    .filter(function (value) { return FormatStringEntrySingletons[value].kind === FormatStringEntryKind_Basic; })
    .map(function (value) { return FormatStringEntrySingletons[value]; });

const s_compoundFormatEntries = Object.keys(FormatStringEntrySingletons)
    .filter(function (value) { return FormatStringEntrySingletons[value].kind === FormatStringEntryKind_Compound; })
    .map(function (value) { return FormatStringEntrySingletons[value]; });

const s_expandoStringRe = new RegExp('^('
    + s_expandoEntries
        .map(function (value) { return value.label; })
        .join('|')
    + ')$');

const s_basicFormatStringRe = new RegExp('^\\${(\\d+):('
    + s_basicFormatEntries
        .map(function (value) { return value.label; })
        .join('|')
    + ')}$');

const s_compoundFormatStringRe = new RegExp('^\\${(\\d+):('
    + s_compoundFormatEntries
        .map(function (value) { return value.label; })
        .join('|')
    + ')(<(\\d+|\\*)?,(\\d+|\\*)?>)}$');

/**
 * Construct a msgFormat entry for a compound formatter.
 * @function
 * @param {Object} formatTag the FormatStringEntrySingleton for this entry
 * @param {number} formatStringStart the index that the format text starts at in the format string
 * @param {number} formatStringEnd the index (1 after) the end of the format text in the format string
 * @param {number} argListPosition the (optional) position to find the format arg in the arg list
 * @param {number} formatExpandDepth the (optional) max depth to expand the argument object
 * @param {number} formatExpandLength the (optional) max number of properties/array length to expand the argument object
 * @returns {Object} a message format entry
 */
function createMsgFormatEntry(formatTag, formatStringStart, formatStringEnd, argListPosition, formatExpandDepth, formatExpandLength) {
    return { format: formatTag, formatStart: formatStringStart, formatEnd: formatStringEnd, argPosition: argListPosition, expandDepth: formatExpandDepth, expandLength: formatExpandLength };
}

/**
 * Take an array or object literal format representation and convert it to json string format representation.
 * @function
 * @param {*} jobj
 * @returns {string}
 */
function expandToJsonFormatter(jobj) {
    let typeid = typeGetIdTag(jobj);

    if ((typeid === TypeNameEnum_Undefined) || (typeid === TypeNameEnum_Null) || (typeid === TypeNameEnum_Boolean) || (typeid === TypeNameEnum_Number)) {
        return JSON.stringify(jobj);
    }
    else if (typeid === TypeNameEnum_String) {
        if (s_expandoStringRe.test(jobj) || s_basicFormatStringRe.test(jobj) || s_compoundFormatStringRe.test(jobj)) {
            return jobj;
        }
        else {
            return '"' + jobj + '"';
        }
    }
    else if (typeid === TypeNameEnum_Object) {
        return '{ '
            + Object.keys(jobj)
                .sort()
                .map(function (key) { return '"' + key + '"' + ': ' + expandToJsonFormatter(jobj[key]); })
                .join(', ')
            + ' }';
    }
    else if (typeid === TypeNameEnum_JsArray) {
        return '[ '
            + jobj
                .map(function (value) { return expandToJsonFormatter(value); })
                .join(', ')
            + ' ]';
    }
    else {
        return '"' + jobj.toString() + '"';
    }
}

/**
 * Helper function to extract and construct an expando format specifier or throws is the expando is malformed.
 * @function
 * @param {string} fmtString the format string we are working on
 * @param {number} vpos the current position in the string
 * @returns {Object} the expando MsgFormatEntry  
 */
function extractExpandoSpecifier(fmtString, vpos) {
    if (fmtString.startsWith('##', vpos)) {
        return createMsgFormatEntry(FormatStringEntrySingletons.LITERAL_HASH, vpos, vpos + '##'.length, -1, -1, -1);
    }
    else {
        let expando = s_expandoEntries.find(function (expando) { return fmtString.startsWith(expando.label, vpos); });
        if (!expando) {
            throw new Error("Bad match in expando format string.");
        }

        return createMsgFormatEntry(expando, vpos, vpos + expando.label.length, -1, -1, -1);
    }
}

/**
 * Helper function to extract and construct an argument format specifier or throws is the format specifier is malformed.
 * @function
 * @param {string} fmtString the format string we are working on
 * @param {number} vpos the current position in the string
 * @returns {Object} the expando MsgFormatEntry  
 */
function extractArgumentFormatSpecifier(fmtString, vpos) {
    if (fmtString.startsWith('$$', vpos)) {
        return createMsgFormatEntry(FormatStringEntrySingletons.LITERAL_DOLLAR, vpos, vpos + '$$'.length, -1, -1, -1);
    }
    else {
        if (!fmtString.startsWith('${', vpos)) {
            throw new Error("Stray '$' in argument formatter.");
        }

        let numberRegex = /\d+/y;
        numberRegex.lastIndex = vpos + '${'.length;

        let argPositionMatch = numberRegex.exec(fmtString);
        if (!argPositionMatch) {
            throw new Error('Bad position specifier in format.');
        }

        let argPosition = Number.parseInt(argPositionMatch[0]);
        if (argPosition < 0) {
            throw new Error('Bad position specifier in format.');
        }

        let specPos = vpos + '${'.length + argPositionMatch[0].length;
        if (fmtString.charAt(specPos) !== ':') {
            throw new Error('Bad position specifier in format.');
        }
        specPos++;

        let cchar = fmtString.charAt(specPos);
        let basicFormatOption = s_basicFormatEntries.find(function (value) { return value.label === cchar; });
        let compoundFormatOption = s_compoundFormatEntries.find(function (value) { return value.label === cchar; });

        if (!basicFormatOption && !compoundFormatOption) {
            throw new Error('Bad format specifier kind.');
        }

        if (basicFormatOption) {
            let fendpos = specPos + 2; //"x}".length
            return createMsgFormatEntry(basicFormatOption, vpos, fendpos, argPosition, -1, -1);
        }
        else {
            let DL_STAR = 1073741824;

            if (fmtString.startsWith('o}', specPos)) {
                return createMsgFormatEntry(FormatStringEntrySingletons.OBJECT_VAL, vpos, specPos + 'o}'.length, argPosition, DEFAULT_EXPAND_DEPTH, DEFAULT_EXPAND_OBJECT_LENGTH);
            }
            else if (fmtString.startsWith('a}', specPos)) {
                return createMsgFormatEntry(FormatStringEntrySingletons.ARRAY_VAL, vpos, specPos + 'a}'.length, argPosition, DEFAULT_EXPAND_DEPTH, DEFAULT_EXPAND_ARRAY_LENGTH);
            }
            else {
                let dlRegex = /([o|a])<(\d+|\*)?,(\d+|\*)?>/y;
                dlRegex.lastIndex = specPos;

                let dlMatch = dlRegex.exec(fmtString);
                if (!dlMatch) {
                    throw new Error('Bad position specifier in format.');
                }

                let ttag = (dlMatch[1] === 'o') ? FormatStringEntrySingletons.OBJECT_VAL : FormatStringEntrySingletons.ARRAY_VAL;
                let tdepth = DEFAULT_EXPAND_DEPTH;
                let tlength = (dlMatch[1] === 'o') ? DEFAULT_EXPAND_OBJECT_LENGTH : DEFAULT_EXPAND_ARRAY_LENGTH;

                if (dlMatch[2] !== '') {
                    tdepth = (dlMatch[2] !== '*') ? Number.parseInt(dlMatch[2]) : DL_STAR;
                }

                if (dlMatch[3] !== '') {
                    tlength = (dlMatch[3] !== '*') ? Number.parseInt(dlMatch[3]) : DL_STAR;
                }

                return createMsgFormatEntry(ttag, vpos, specPos + dlMatch[0].length, argPosition, tdepth, tlength);
            }
        }
    }
}

/**
 * Construct a msgFormat object.
 * @function
 * @param {string} fmtName the name of the format
 * @param {string} fmtString the raw format string
 * @param {number} maxArgPos the largest arg used in the format
 * @param {Array} fmtEntryArray the array of MsgFormatEntry objects
 * @param {bool} areAllSingleSlotFormatters true of all the formatters use only a single slot
 * @returns {Object} our MsgFormat object
 */
function createMsgFormat(fmtName, fmtString, maxArgPos, fmtEntryArray, areAllSingleSlotFormatters) {
    return { formatName: fmtName, formatString: fmtString, maxArgPosition: maxArgPos, formatterArray: fmtEntryArray, allSingleSlotFormatters: areAllSingleSlotFormatters };
}

/**
 * Takes a message format string and converts it to our internal format structure.
 * @function
 * @param {string} fmtName the name of the format
 * @param {string|Object} fmtString the raw format string or a JSON style format
 * @returns {Object} our MsgFormat object
 */
function extractMsgFormat(fmtName, fmtInfo) {
    let cpos = 0;

    if (typeof (fmtName) !== 'string') {
        throw 'Name needs to be a string.'
    }

    let fmtString = undefined;
    if (typeof (fmtInfo) === 'string') {
        fmtString = fmtInfo;
    }
    else {
        let typeid = typeGetIdTag(fmtInfo);
        if (typeid !== TypeNameEnum_JsArray && typeid !== TypeNameEnum_Object) {
            throw new Error('Format description options are string | object layout | array layout.');
        }

        fmtString = expandToJsonFormatter(fmtInfo);
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
            let fmt = (cchar === '#') ? extractExpandoSpecifier(fmtString, cpos) : extractArgumentFormatSpecifier(fmtString, cpos);
            fArray.push(fmt);

            if (fmt.fposition) {
                maxArgPos = Math.max(maxArgPos, fmt.fposition);
            }

            cpos = fmt.formatEnd;
        }
    }

    let allBasicFormatters = fArray.every(function (value) {
        return value.isSingleSlot;
    });

    return createMsgFormat(fmtName, fmtString, maxArgPos, fArray, allBasicFormatters);
}

/////////////////////////////
//Code for representing the log messages in the low overhead in memory-ring buffer and moving them into/out of this structure

/**
 * Tag values indicating the kind of each entry in the fast log buffer
 */
const LogEntryTags_Clear = 0;
const LogEntryTags_MsgFormat = 1;
const LogEntryTags_MsgLevel = 2;
const LogEntryTags_MsgEndSentinal = 3;
const LogEntryTags_LParen = 4;
const LogEntryTags_RParen = 5;
const LogEntryTags_LBrack = 6;
const LogEntryTags_RBrack = 7;
const LogEntryTags_PropertyRecord = 8;
const LogEntryTags_JsBadFormatVar = 9;
const LogEntryTags_JsVarValue = 10;
const LogEntryTags_LengthBoundHit = 11;
const LogEntryTags_CycleValue = 12;
const LogEntryTags_OpaqueValue = 13;
const LogEntryTags_OpaqueObject = 14;
const LogEntryTags_OpaqueArray = 15;

/**
 * The number of entries we have in a msg block.
 */
const s_msgBlockSize = 1024;

//internal function for allocating a block
function createMsgBlock(previousBlock) {
    const nblock = {
        count: 0,
        tags: new Uint8Array(s_msgBlockSize),
        data: new Array(s_msgBlockSize),
        next: null,
        previous: previousBlock
    };

    if (previousBlock) {
        previousBlock.next = nblock;
    }

    return nblock;
}

/**
 * BlockList constructor
 * @constructor
 */
function BlockList() {
    this.head = createMsgBlock(null);
    this.tail = this.head;
    this.jsonCycleMap = new Set();
}

/**
 * Clear the contents of the block list
 * @method
 */
BlockList.prototype.clear = function () {
    this.head.tags.fill(LogEntryTags_Clear, this.head.count);
    this.head.data.fill(undefined, this.head.count);
    this.head.count = 0;
    this.head.next = null;

    this.tail = this.head;
};

/**
 * Add an entry to the message block
 * @method
 * @param {number} tag the tag for the entry
 * @param {*} data the data value for the entry
 */
BlockList.prototype.addEntry = function (tag, data) {
    let block = this.tail;
    if (block.count === s_msgBlockSize) {
        block = createMsgBlock(block);
        this.tail = block;
    }

    block.tags[block.count] = tag;
    block.data[block.count] = data;
    block.count++;
};

/**
 * Add an entry to the message block that has the common JsVarValue tag
 * @method
 * @param {*} data the data value for the entry
 */
BlockList.prototype.addJsVarValueEntry = function (data) {
    let block = this.tail;
    if (block.count === s_msgBlockSize) {
        block = createMsgBlock(block);
        this.tail = block;
    }

    block.tags[block.count] = LogEntryTags_JsVarValue;
    block.data[block.count] = data;
    block.count++;
};

/**
 * Add an entry to the message block that has no extra data
 * @method
 * @param {number} tag the tag value for the entry
 */
BlockList.prototype.addTagOnlyEntry = function (tag) {
    let block = this.tail;
    if (block.count === s_msgBlockSize) {
        block = createMsgBlock(block);
        this.tail = block;
    }

    block.tags[block.count] = tag;
    block.count++;
};

/**
 * Add functions to process general values via lookup on typeid number in prototype array
 */
const AddGeneralValue_RemainingTypesCallTable = new Array(TypeNameEnum_Limit);
AddGeneralValue_RemainingTypesCallTable.fill(null);

AddGeneralValue_RemainingTypesCallTable[TypeNameEnum_Date] = function (blockList, value, depth) { blockList.addJsVarValueEntry(new Date(value)); };
AddGeneralValue_RemainingTypesCallTable[TypeNameEnum_Function] = function (blockList, value, depth) { blockList.addJsVarValueEntry('[ #Function# ' + value.name + ' ]'); };

AddGeneralValue_RemainingTypesCallTable[TypeNameEnum_Object] = function (blockList, value, depth) { blockList.addExpandedObject(value, depth, DEFAULT_EXPAND_OBJECT_LENGTH); };
AddGeneralValue_RemainingTypesCallTable[TypeNameEnum_JsArray] = function (blockList, value, depth) { blockList.addExpandedArray(value, depth, DEFAULT_EXPAND_ARRAY_LENGTH); };
AddGeneralValue_RemainingTypesCallTable[TypeNameEnum_TypedArray] = function (blockList, value, depth) { blockList.addExpandedArray(value, depth, DEFAULT_EXPAND_ARRAY_LENGTH); };

AddGeneralValue_RemainingTypesCallTable[TypeNameEnum_Unknown] = function (blockList, value, depth) { blockList.addTagOnlyEntry(LogEntryTags_OpaqueObject); };


/**
 * Add an expanded object value to the log
 * @method
 * @param {Object} obj the object to expand into the log
 * @param {number} depth the max depth to recursively expand the object
 * @param {number} length the max number of properties to expand
 */
BlockList.prototype.addExpandedObject = function (obj, depth, length) {
    //if the value is in the set and is currently processing
    if (this.jsonCycleMap.has(obj)) {
        this.addTagOnlyEntry(LogEntryTags_CycleValue);
        return;
    }

    if (depth === 0) {
        this.addTagOnlyEntry(LogEntryTags_OpaqueObject);
    }
    else {
        //Set processing as true for cycle detection
        this.jsonCycleMap.add(obj);
        this.addTagOnlyEntry(LogEntryTags_LParen);

        let allowedLengthRemain = length;
        for (let p in obj) {
            this.addEntry(LogEntryTags_PropertyRecord, p);

            const value = obj[p];
            const typeid = typeGetIdTag(value);
            if (typeid <= TypeNameEnum_LastSimpleType) {
                this.addJsVarValueEntry(value)
            }
            else {
                (AddGeneralValue_RemainingTypesCallTable[typeid])(this, value, depth);
            }

            allowedLengthRemain--;
            if (allowedLengthRemain <= 0) {
                this.addTagOnlyEntry(LogEntryTags_LengthBoundHit);
                break;
            }
        }

        //Set processing as false for cycle detection
        this.jsonCycleMap.delete(obj);
        this.addTagOnlyEntry(LogEntryTags_RParen);
    }
};

/**
 * Add an expanded array value to the log
 * @method
 * @param {Array} obj the array to expand into the log
 * @param {number} depth the max depth to recursively expand the array
 * @param {number} length the max number of index entries to expand
 */
BlockList.prototype.addExpandedArray = function (obj, depth, length) {
    //if the value is in the set and is currently processing
    if (this.jsonCycleMap.has(obj)) {
        this.addTagOnlyEntry(LogEntryTags_CycleValue);
        return;
    }

    if (depth === 0) {
        this.addTagOnlyEntry(LogEntryTags_OpaqueObject);
    }
    else {
        //Set processing as true for cycle detection
        this.jsonCycleMap.add(obj);
        this.addTagOnlyEntry(LogEntryTags_LBrack);

        for (let i = 0; i < obj.length; ++i) {
            const value = obj[i];
            const typeid = typeGetIdTag(value);
            if (typeid <= TypeNameEnum_LastSimpleType) {
                this.addJsVarValueEntry(value)
            }
            else {
                (AddGeneralValue_RemainingTypesCallTable[typeid])(this, value, depth);
            }

            if (i >= length) {
                this.addTagOnlyEntry(LogEntryTags_LengthBoundHit);
                break;
            }
        }

        //Set processing as false for cycle detection
        this.jsonCycleMap.delete(obj);
        this.addTagOnlyEntry(LogEntryTags_RBrack);
    }
};

////////

/**
 * A table that maps from basic format type enums to the typeid that is permissible for that formatter
 */
const FormatTypeToArgTypeCheckArray = new Array(FormatStringEntrySingleton_EnumLimit);
FormatTypeToArgTypeCheckArray.fill(0);

FormatTypeToArgTypeCheckArray[FormatStringEntrySingletons.BOOL_VAL.enum] = TypeNameEnum_Boolean;
FormatTypeToArgTypeCheckArray[FormatStringEntrySingletons.NUMBER_VAL.enum] = TypeNameEnum_Number;
FormatTypeToArgTypeCheckArray[FormatStringEntrySingletons.STRING_VAL.enum] = TypeNameEnum_String;

const LogMessage_RemainingTypesCallTable = new Array(FormatStringEntrySingleton_EnumLimit);
LogMessage_RemainingTypesCallTable.fill(null);

LogMessage_RemainingTypesCallTable[FormatStringEntrySingletons.OBJECT_VAL.enum] = function (blockList, valueid, value, formatEntry) {
    if (valueid === TypeNameEnum_Object) {
        blockList.addExpandedObject(value, formatEntry.depth, formatEntry.length);
    }
    else {
        blockList.addTagOnlyEntry(LogEntryTags_JsBadFormatVar);
    }
};

LogMessage_RemainingTypesCallTable[FormatStringEntrySingletons.ARRAY_VAL.enum] = function (blockList, valueid, value, formatEntry) {
    if ((valueid === TypeNameEnum_JsArray) || (valueid === TypeNameEnum_TypedArray)) {
        blockList.addExpandedArray(value, formatEntry.depth, formatEntry.length);
    }
    else {
        blockList.addTagOnlyEntry(LogEntryTags_JsBadFormatVar);
    }
};

/**
 * Log a message into the logger
 * @method
 * @param {Object} macroInfo a record with the info for certain expando formatter entries
 * @param {Object} level the level the message is being logged at
 * @param {Object} fmt the format of the message
 * @param {Array} args the arguments for the format message
 */
BlockList.prototype.logMessage = function (macroInfo, level, fmt, args) {
    this.addEntry(LogEntryTags_MsgFormat, fmt);
    this.addEntry(LogEntryTags_MsgLevel, level);

    for (let i = 0; i < fmt.formatterArray.length; ++i) {
        const formatEntry = fmt.formatterArray[i];
        const formatSpec = formatEntry.format;

        if (formatSpec.kind === FormatStringEntryKind_Literal) {
            ; //don't need to do anything!
        }
        else if (formatSpec.kind === FormatStringEntryKind_Expando) {
            if (formatSpec.enum <= FormatStringEntrySingleton_LastMacroInfoExpandoEnum) {
                this.addJsVarValueEntry(macroInfo[formatSpec.name]);
            }
            else {
                if (formatSpec === FormatStringEntrySingletons.MSG_NAME) {
                    this.addJsVarValueEntry(fmt.name);
                }
                else {
                    //TODO: remove this later but useful for initial testing
                    assert(formatSpec === FormatStringEntrySingletons.WALLTIME, 'Should not be any other options');
                    this.addJsVarValueEntry(Date.now());
                }
            }
        }
        else {
            //TODO: remove this after we are done debugging a bit
            assert(formatSpec.kind === FormatStringEntryKind_Basic || formatSpec.kind === FormatStringEntryKind_Compound, "No other options");

            if (formatEntry.argPosition >= args.length) {
                //We hit a bad format value so rather than let it propigate -- report and move on.
                this.addTagOnlyEntry(LogEntryTags_JsBadFormatVar);
            }
            else {
                const value = args[formatEntry.argPosition];
                const typeid = typeGetIdTag(value);

                if (formatSpec.enum <= FormatStringEntrySingleton_LastBasicFormatterEnum) {
                    if (FormatTypeToArgTypeCheckArray[formatSpec.enum] === typeid) {
                        this.addJsVarValueEntry(value);
                    }
                    else {
                        this.addTagOnlyEntry(LogEntryTags_JsBadFormatVar);
                    }
                }
                else if (formatSpec === FormatStringEntrySingletons.GENERAL_VAL) {
                    if (typeid <= TypeNameEnum_LastSimpleType) {
                        this.addJsVarValueEntry(value)
                    }
                    else {
                        (AddGeneralValue_RemainingTypesCallTable[typeid])(this, typeid, value, depth);
                    }
                }
                else {
                    (LogMessage_RemainingTypesCallTable[formatSpec.enum])(this, typeid, fmt, value)
                }
            }
        }
    }

    this.addTagOnlyEntry(LogEntryTags_MsgEndSentinal);
}

/////////////////////////////
//Code for filtering the in memory representation and for writing out

/**
 * Check if the message (starting at this[cpos]) is enabled for writing at the given level
 * @function
 * @param {Object} cblock the current block we are processing
 * @param {number} cpos the position to check the level at
 * @param {Object} the logging level we want to see if is enabled
 * @returns {bool}
 */
function isLevelEnabledForWrite(cblock, cpos, trgtLevel) {
    //TODO: take this out later for performance but good initial sanity check
    assert((cpos + 1 < cblock.count) ? cblock.tags[cpos + 1] : block.next.tags[0] === LogEntryTags_MsgLevel);

    let mlevel = (cpos + 1 < cblock.count) ? cblock.data[cpos + 1] : block.next.data[0];
    return (mlevel.enum & trgtLevel.enum) === mlevel.enum;
}

/**
 * (1) Filter out all the msgs that we want to drop when writing to disk and copy them to the pending write list.
 * (2) Process the blocks for native emitting (if needed)
 * @method
 * @param {Object} retainLevel the logging level to retain at
 * @param {Object} pendingWriteBlockList the block list to add into
 * @param {bool} clearMemoryBlockList a flag indicating if we want to clear the block list after the copy
 */
BlockList.prototype.processMsgsForWrite = function (retainLevel, pendingWriteBlockList, clearMemoryBlockList) {
    let scanForMsgEnd = false;
    for (let cblock = this.head; cblock !== null; cblock = cblock.next) {
        let pos = 0;
        while (pos < cblock.count) {
            if (scanForMsgEnd) {
                while (scanForMsgEnd && pos < cblock.count) {
                    scanForMsgEnd = (cblock.tags[pos] !== LogEntryTags_MsgEndSentinal);

                    pos++;
                }
            }
            else {
                while (!scanForMsgEnd && pos < cblock.count) {
                    if (cblock.tags[pos] === LogEntryTags_MsgFormat && !isLevelEnabledForWrite(cblock, pos, retainLevel)) {
                        scanForMsgEnd = true;
                    }
                    else {
                        pendingWriteBlockList.addEntry(cblock.tags[pos], cblock.data[pos]);
                    }

                    pos++;
                }
            }
        }
    }

    if (clearMemoryBlockList) {
        this.clear();
    }
}

/////////////////////////////
//Code for pure JS write to storage

/**
 * When we are emitting we can be in multiple modes (formatting, objects, arrays, etc.) so we want tags (used below to indicate)
 */
const EmitMode_Clear = 0;
const EmitMode_MsgFormat = 1;
const EmitMode_ObjectLevel = 2;
const EmitMode_ArrayLevel = 3;

/**
 * Constructor for a format stack state entry
 * @constructor
 * @param {number} emitState 
 * @param {*} fmt the (optional) formatEntry if emitState is EmitMode_MsgFormat
 */
function FormatStateEntry(emitState, fmt) {
    this.mode = emitState;
    this.commaInsert = fmt ? false : true;
    if (fmt !== undefined) {
        this.formatEnum = fmt.enum;
        this.formatString = fmt.formatString;
        this.formatArray = fmt.formatterArray;
        this.formatterIndex = 0;
    }
}

/**
 * Check if we need to insert a comma (and update the comma insert state)
 * @method
 * @returns {bool}
 */
FormatStateEntry.prototype.checkAndUpdateNeedsComma = function () {
    if (this.commaInsert) {
        return true;
    }
    else {
        this.commaInsert = true;
        return false;
    }
};

/**
 * Get the start position for a span of literal text in a format string to emit.
 * @method
 * @returns {number}
 */
FormatStateEntry.prototype.getFormatRangeStart = function () {
    return this.formatArray[this.formatterIndex].formatEnd;
};

/**
 * Get the end position for a span of literal text in a format string to emit.
 * @method
 * @returns {number}
 */
FormatStateEntry.prototype.getFormatRangeEnd = function () {
    return (this.formatterIndex + 1 < this.formatArray.length) ? this.formatArray[this.formatterIndex + 1].formatStart : this.formatString.length;
};


/**
 * Constructor for a blockList emitter
 * @constructor
 * @param {Object} writer for the data
 */
function Emitter(writer) {
    this.blockList = null;
    this.block = null;
    this.pos = 0;
    this.writer = writer;
    this.stateStack = [];
}

/**
 * Output a string as a quoted JavaScript string.
 * @method
 */
Emitter.prototype.emitJsString = function (str) {
    this.writer.emitChar('"');
    this.writer.emitFullString(str);
    this.writer.emitChar('"');
}

/**
 * Output the start of a log message.
 * @method
 */
Emitter.prototype.emitEntryStart = function () {
    this.writer.emitChar('>');
}

/**
 * Output the end of a log message.
 * @method
 */
Emitter.prototype.emitEntryEnd = function () {
    this.writer.emitChar('\n');
}

/**
 * Emit a simple var (JsVarValue tag)
 * @method
 * @param {Object} value  
 */
Emitter.prototype.emitSimpleVar = function (value) {
    if (value === undefined) {
        this.writer.emitFullString('undefined');
    }
    else if (value === null) {
        this.writer.emitFullString('null');
    }
    else {
        this.writer.emitFullString(value.toString());
    }
}

/**
 * Emit a special var as indicated by the tag
 * @method
 * @param {number} tag
 */
Emitter.prototype.emitSpecialVar = function (tag) {
    switch (tag) {
        case LogEntryTags_JsBadFormatVar:
            this.writer.emitFullString('"<BadFormat>"');
            break;
        case LogEntryTags_LengthBoundHit:
            this.writer.emitFullString('<LengthBoundHit>"');
            break;
        case LogEntryTags_CycleValue:
            this.writer.emitFullString('"<Cycle>"');
            break;
        case LogEntryTags_OpaqueValue:
            this.writer.emitFullString('"<Value>"');
            break;
        case LogEntryTags_OpaqueObject:
            this.writer.emitFullString('"<Object>"');
            break;
        case LogEntryTags_OpaqueArray:
            this.writer.emitFullString('"<Array>"');
            break;
        default:
            assert(false, "Unknown case in switch statement for special var emit.");
            break;
    }
}

/**
 * Append a new blocklist into the current one in this emitter
 * @method
 * @param {BlockList} blockList the data to add to the emitter worklist
 */
Emitter.prototype.appendBlockList = function (blockList) {
    if (this.blockList === null) {
        this.blockList = blockList;
        this.block = blockList.head;
        this.pos = 0;
    }
    else {
        assert(false, 'Need to add append code here!!!');
    }
}

/**
 * Push top a formatter state onto the processing stack
 * @method
 * @param {number} mode
 * @param {string} leadToken the (optional) token to emit
 * @param {Object} fmt the (optional) format entry
 */
Emitter.prototype.pushFormatState = function (mode, leadToken, fmt) {
    this.stateStack.push(new FormatStateEntry(EmitMode_MsgFormat, fmt));
    if (leadToken !== undefined) {
        this.writer.emitChar(leadToken);
    }
}

/**
 * Peek at the top emitter stack state
 * @method
 * @returns {Object} the top emit stack state
 */
Emitter.prototype.peekEmitState = function () {
    return this.stateStack[this.stateStack.length - 1];
}

/**
 * Pop and emitter state and write any needed closing } or ] and fill in any string format text
 * @method
 */
Emitter.prototype.popEmitState = function () {
    const pentry = this.stateStack.pop();
    if (pentry.mode == EmitMode_MsgFormat) {
        this.emitEntryEnd();
    }
    else {
        this.writer.emitChar(pentry.mode === EmitMode_ObjectLevel ? '}' : ']');

        const sentry = this.peekEmitState();
        if (sentry.mode === EmitMode_MsgFormat) {
            this.emitFormatMsgSpan(sentry);
        }
    }
}

/**
 * Write the msg format literal text between two format specifiers (or string end).
 * @method
 * @param {Object} currStackEntry the current state stack entry
 */
Emitter.prototype.emitFormatMsgSpan = function (currStackEntry) {
    const start = currStackEntry.getFormatRangeStart();
    const end = currStackEntry.getFormatRangeEnd();

    this.writer.emitStringSpan(currStackEntry.formatString, start, end);
    currStackEntry.formatterIndex++;
}

/**
 * Emit a value when we are in format entry mode.
 * @method
 * @param {Object} currStackEntry the current state stack entry
 * @returns {bool} true if we finished emitting a format message
 */
Emitter.prototype.emitFormatEntry = function (currStackEntry) {
    assert(currStackEntry.mode === EmitMode_MsgFormat, "Shound not be here then.");

    while (this.pos < this.block.count) {
        const tag = this.block.tags[this.pos];
        if (tag === LogEntryTags_MsgEndSentinal) {
            this.popEmitState();

            //don't advance pos here -- it will get taken care of in top loop
            return true;
        }

        if (tag === LogEntryTags_LParen) {
            this.pushFormatState(EmitMode_ObjectLevel, '{', undefined);

            this.pos++;
            this.emitObjectEntry(this.peekEmitState());
        }
        else if (tag === LogEntryTags_LBrack) {
            this.pushFormatState(EmitMode_ArrayLevel, '[', undefined);

            this.pos++;
            this.emitArrayEntry(this.peekEmitState());
        }
        else if (tag === LogEntryTags_JsBadFormatVar || tag === LogEntryTags_OpaqueValue) {
            this.emitSpecialVar(tag);
            this.pos++
        }
        else if (tag === LogEntryTags_MsgLevel) {
            const data = this.block.data[this.pos];
            this.emitEntryStart();

            this.writer.emitFullString('level: ');
            this.writer.emitFullString(data.label);

            this.writer.emitFullString(', msg: ')
            if (currStackEntry.formatArray.length === 0) {
                this.writer.emitFullString(currStackEntry.formatString);
            }
            else {
                const fpos = currStackEntry.formatArray[0].formatStart;
                this.writer.emitStringSpan(currStackEntry.formatString, 0, fpos);
            }

            this.pos++;
        }
        else {
            const data = this.block.data[this.pos];
            const formatEntry = currStackEntry.formatArray[currStackEntry.formatterIndex];
            const formatSpec = formatEntry.format;

            if (formatSpec.kind === FormatStringEntryKind_Literal) {
                this.writer.emitChar(formatEntry === FormatStringEntrySingletons.LITERAL_HASH ? '#' : '$');
            }
            else if (formatSpec.kind === FormatStringEntryKind_Expando) {
                if (formatSpec.enum <= FormatStringEntrySingleton_LastMacroInfoExpandoEnum) {
                    this.writer.emitFullString(data.toString());
                }
                else {
                    if (formatSpec === FormatStringEntrySingletons.MSG_NAME) {
                        this.writer.emitFullString(data.toString());
                    }
                    else {
                        this.writer.emitFullString(new Date(data).toISOString());
                    }
                }
            }
            else {
                this.emitSimpleVar(data);
            }

            this.emitFormatMsgSpan(currStackEntry);
            this.pos++;
        }
    }

    return false;
}

/**
 * Emit a value when we are in object entry mode.
 * @method
 * @param {Object} currStackEntry the current state stack entry
 */
Emitter.prototype.emitObjectEntry = function (currStackEntry) {
    assert(currStackEntry.mode === EmitMode_ObjectLevel, "Shound not be here then.");

    while (this.pos < this.block.count) {
        const tag = this.block.tags[this.pos];
        const data = this.block.data[this.pos];

        if (tag === LogEntryTags_RParen) {
            this.popEmitState();

            //advance pos here -- it is needed or we move to this.pos === this.block.count and top level loop will sort it out right
            this.cpos++;
            return;
        }

        if (tag === LogEntryTags_PropertyRecord) {
            if (currStackEntry.checkAndUpdateNeedsComma()) {
                this.writer.emitFullString(', ');
            }

            this.emitJsString(data);
            this.writer.emitFullString(': ');

            this.pos++;
        }
        else if (tag === LogEntryTags_LParen) {
            this.pushFormatState(EmitMode_ObjectLevel, '{', undefined);

            this.pos++;
            this.emitObjectEntry(this.peekEmitState());
        }
        else if (tag === LogEntryTags_LBrack) {
            this.pushArrayState(emitter);

            this.pos++;
            this.emitArrayEntry(this.peekEmitState());
        }
        else if (tag === LogEntryTags_JsVarValue) {
            this.emitSimpleVar(data);
            this.pos++;
        }
        else {
            this.emitSpecialVar(tag);
            this.pos++;
        }
    }
}

/**
 * Emit a value when we are in array entry mode.
 * @method
 * @param {Object} currStackEntry the current state stack entry
 * @param {number} tag the value tag from the log
 * @param {*} data the value data from the log
 */
Emitter.prototype.emitArrayEntry = function (currStackEntry, tag, data) {
    assert(currStackEntry.mode === EmitMode_ObjectLevel, "Shound not be here then.");

    while (this.pos < this.block.count) {
        const tag = this.block.tags[this.pos];
        const data = this.block.data[this.pos];

        if (tag === LogEntryTags_RBrack) {
            this.popEmitState();

            //advance pos here -- it is needed or we move to this.pos === this.block.count and top level loop will sort it out right
            this.cpos++;
            return;
        }

        if (currStackEntry.checkAndUpdateNeedsComma()) {
            this.writer.emitFullString(', ');
        }

        if (tag === LogEntryTags_LParen) {
            this.pushFormatState(EmitMode_ObjectLevel, '{', undefined);

            this.pos++;
            this.emitObjectEntry(this.peekEmitState());
        }
        else if (tag === LogEntryTags_LBrack) {
            this.pushFormatState(EmitMode_ArrayLevel, '[', undefined);

            this.pos++;
            this.emitArrayEntry(this.peekEmitState());
        }
        else if (tag === LogEntryTags_JsVarValue) {
            this.emitSimpleVar(data);
            this.cpos++;
        }
        else {
            this.emitSpecialVar(tag);
            this.cpos++;
        }
    }
}

/**
 * Emit a single message -- return true if more to emit false otherwise
 * @method
 * @param {Object} currStackEntry the current state stack entry
 * @returns {bool} true if we finished emitting a format message
 */
Emitter.prototype.emitMsg = function (currStackEntry) {
    const state = currStackEntry.mode;

    if (state === EmitMode_MsgFormat) {
        return this.emitFormatEntry(currStackEntry);
    }
    else {
        if (state === EmitMode_ObjectLevel) {
            this.emitObjectEntry(currStackEntry);
        }
        else {
            this.emitArrayEntry(currStackEntry);
        }
        return false;
    }
}

/**
 * The main process loop for the emitter -- write a full message and check if drain is required + cb invoke.
 * @method
 * @param {bool} clearWhenDone true if we want to clear the blocks when we are done
 * @param {Function} fcb the (optional) final callback when the all the data is flushed
 */
Emitter.prototype.processLoop = function (clearWhenDone, fcb) {
    let flush = false;
    while (this.block !== null && this.pos != this.block.count && !flush) {
        const tag = this.block.tags[this.pos];

        if (tag === LogEntryTags_MsgFormat) {
            this.pushFormatState(EmitMode_MsgFormat, undefined, this.block.data[this.pos]);
        }
        else {
            const currStackEntry = this.peekEmitState();
            const msgCompleted = this.emitMsg(currStackEntry);

            if (msgCompleted) {
                flush = this.writer.needsToDrain();
            }
        }

        //Advance the position of the emitter
        if (this.pos < this.block.count - 1) {
            this.pos++;
        }
        else {
            this.block = this.block.next;
            this.pos = 0;
        }
    }

    //if we need to flush then call the writer drain with a callback to us
    if (flush) {
        const _self = this;
        this.writer.drain(function () {
            _self.processLoop(clearWhenDone, fcb);
        });
    }
    else {
        if(clearWhenDone) {
            this.blockList.clear();
            this.blockList = null;
            this.block = null;
            this.pos = 0;
        }

        let lcb = fcb || function () { ; };
        this.writer.drain(lcb);
    }
}

/**
 * Call this method to emit a blocklist (as needed).
 * @method
 * @param {BlockList} blockList the BlockList of data we want to have emitted
 * @param {bool} clearWhenDone true if we want to clear the blocks when we are done
 * @param {Function} fcb the (optional) final callback when the all the data is flushed
 */
Emitter.prototype.emitBlockList = function (blockList, clearWhenDone, fcb) {
    this.appendBlockList(blockList);
    this.processLoop(clearWhenDone, fcb);
}

/////////////////////////////
//Code for the actual exported logger

/**
 * Check if the message (starting at this[cpos]) is enabled for writing at the given level
 * @function
 */
function isLevelEnabledForLogging(checkLevel, enabledLevel) {
    return (checkLevel.enum & enabledLevel.enum) === checkLevel.enum;
}

/**
 * Log a message into the logger -- specialized for NOP
 */
function doMsgLog_NOP(level, fmt, ...args) { ; }

/**
 * Constructor for the RootLogger
 * @constructor
 * @param {string} appName name of the root module (application)
 * @param {Object} writer the writer that we can eventually emit into
 * @param {string} ip the ip address of the host
 */
function LoggerFactory(appName, writer, ip) {
    //Since this will be exposed to the user we want to protect the state from accidental 
    //modification. This state is common to all loggers and will be shared.
    const m_globalMacroInfo = {
        IP_ADDR: ip,
        APP_NAME: appName,
        MODULE_NAME: appName,
        LOGICAL_TIME: 0,
        CALLBACK_ID: -1,
        REQUEST_ID: -1
    };

    //Blocklists containing the information logged into memory and pending to write out
    const m_memoryBlockList = new BlockList();
    const m_writeBlockList = new BlockList();

    //The writer to emit data from the writeBlockList
    const m_emitter = new Emitter(writer);

    /**
     * Create a logger for a given module
     * @param {string} moduleName name of the module this is defined for
     * @param {Object} memoryLevel the level to write into memory log
     * @param {Object} writeLevel the level to write into the stable storage writer
     */
    this.createLogger = function (moduleName, memoryLevel, writeLevel) {
        return new Logger(moduleName, memoryLevel, writeLevel);
    }

    //////////
    //Define the actual logger class that gets created for each module require

    /**
    * Constructor for a Logger
    * @constructor
    * @param {string} moduleName name of the module this is defined for
    * @param {Object} memoryLevel the level to write into memory log
    * @param {Object} writeLevel the level to write into the stable storage writer
    */
    function Logger(moduleName, memoryLevel, writeLevel) {
        let m_memoryLogLevel = memoryLevel;
        let m_writeLogLevel = writeLevel;

        //all the formats we know about string -> MsgFormat Object
        const m_formatInfo = new Map();

        let m_macroInfo = Object.create(m_globalMacroInfo);
        m_macroInfo.MODULE_NAME = moduleName;

        /**
         * Update the logical time/requestId/callbackId/etc.
         */
        this.incrementLogicalTime = function () { m_globalMacroInfo.LOGICAL_TIME++; }

        this.getCurrentRequestId = function () { m_globalMacroInfo.REQUEST_ID; }
        this.setCurrentRequestId = function (requestId) { m_globalMacroInfo.REQUEST_ID = requestId; }

        this.getCurrentCallbackId = function () { m_globalMacroInfo.CALLBACK_ID; }
        this.setCurrentCallbackId = function (callbackId) { m_globalMacroInfo.CALLBACK_ID = callbackId; }

        /**
         * Add a new format to the format map
         */
        this.addFormat = function (fmtName, fmtInfo) {
            try {
                const fmtObj = extractMsgFormat(fmtName, fmtInfo);
                m_formatInfo.set(fmtName, fmtObj);
            }
            catch (ex) {
                process.stderr.write('Hard failure in format extract -- ' + ex.toString() + '\n');
            }
        }

        /**
         * Log a messages at various levels.
         */
        this.fatal = isLevelEnabledForLogging(LoggingLevels.FATAL, memoryLevel)
            ? function (fmt, ...args) {
                try {
                    const fmti = m_formatInfo.get(fmt);
                    if (fmti === undefined) {
                        throw new Error('Format name is not defined for this logger: ' + fmt);
                    }

                    m_memoryBlockList.logMessage(m_macroInfo, LoggingLevels.FATAL, fmti, args);
                }
                catch (ex) {
                    process.stderr.write('Hard failure in logging -- ' + ex.toString() + '\n');
                }
            }
            : doMsgLog_NOP;

        this.error = isLevelEnabledForLogging(LoggingLevels.ERROR, memoryLevel)
            ? function (fmt, ...args) {
                try {
                    const fmti = m_formatInfo.get(fmt);
                    if (fmti === undefined) {
                        throw new Error('Format name is not defined for this logger: ' + fmt);
                    }

                    m_memoryBlockList.logMessage(m_macroInfo, LoggingLevels.ERROR, fmti, args);
                }
                catch (ex) {
                    process.stderr.write('Hard failure in logging -- ' + ex.toString() + '\n');
                }
            }
            : doMsgLog_NOP;

        this.warn = isLevelEnabledForLogging(LoggingLevels.WARN, memoryLevel)
            ? function (fmt, ...args) {
                try {
                    const fmti = m_formatInfo.get(fmt);
                    if (fmti === undefined) {
                        throw new Error('Format name is not defined for this logger: ' + fmt);
                    }

                    m_memoryBlockList.logMessage(m_macroInfo, LoggingLevels.WARN, fmti, args);
                }
                catch (ex) {
                    process.stderr.write('Hard failure in logging -- ' + ex.toString() + '\n');
                }
            }
            : doMsgLog_NOP;

        this.info = isLevelEnabledForLogging(LoggingLevels.INFO, memoryLevel)
            ? function (fmt, ...args) {
                try {
                    const fmti = m_formatInfo.get(fmt);
                    if (fmti === undefined) {
                        throw new Error('Format name is not defined for this logger: ' + fmt);
                    }

                    m_memoryBlockList.logMessage(m_macroInfo, LoggingLevels.INFO, fmti, args);
                }
                catch (ex) {
                    process.stderr.write('Hard failure in logging -- ' + ex.toString() + '\n');
                }
            }
            : doMsgLog_NOP;

        this.debug = isLevelEnabledForLogging(LoggingLevels.DEBUG, memoryLevel)
            ? function (fmt, ...args) {
                try {
                    const fmti = m_formatInfo.get(fmt);
                    if (fmti === undefined) {
                        throw new Error('Format name is not defined for this logger: ' + fmt);
                    }

                    m_memoryBlockList.logMessage(m_macroInfo, LoggingLevels.DEBUG, fmti, args);
                }
                catch (ex) {
                    process.stderr.write('Hard failure in logging -- ' + ex.toString() + '\n');
                }
            }
            : doMsgLog_NOP;

        this.trace = isLevelEnabledForLogging(LoggingLevels.TRACE, memoryLevel)
            ? function (fmt, ...args) {
                try {
                    const fmti = m_formatInfo.get(fmt);
                    if (fmti === undefined) {
                        throw new Error('Format name is not defined for this logger: ' + fmt);
                    }

                    m_memoryBlockList.logMessage(m_macroInfo, LoggingLevels.TRACE, fmti, args);
                }
                catch (ex) {
                    process.stderr.write('Hard failure in logging -- ' + ex.toString() + '\n');
                }
            }
            : doMsgLog_NOP;

        /**
         * Process the current message set for writing 
         */
        this.processMsgsForWrite = function() {
            m_memoryBlockList.processMsgsForWrite(m_writeLogLevel, m_writeBlockList, true);
        }

        /**
         * Emit the messages in our queue
         */
        this.emit = function(optCompleteFunction) {
            m_emitter.emitBlockList(m_writeBlockList, true, optCompleteFunction);
        }

        /**
         * Process msgs and emit them immedately to a special location ...
         */
        this.processAndEmitImmediate = function (altWriter) {
            //TODO probably want to set the alt writer as an option instead of argument here...
            assert(false, 'Not implemented yet');
        }
    }
}

/////////////////////////////
//Code for various writer implementations

/**
 * Create a basic console writer 
 */
function createConsoleWriter() {
    let process = require('process');
    let sb = '';
    return {
        emitChar: function (c) {
            sb = sb + c;
        },
        emitFullString: function (str) {
            sb = sb + str;
        },
        emitStringSpan: function (str, start, end) {
            sb = sb + str.substr(start, end - start);
        },
        needsToDrain: function () {
            if (sb.length > 2048) {
                return true;
            }
        },
        drain: function (cb) {
            let wb = sb;
            sb = '';
            process.stdout.write(wb, cb);
        }
    }
}

/////////////////////////////
//Exports

//Export the logging and systemlogging level enums
exports.LoggingLevels = LoggingLevels;
exports.SystemInfoLevels = SystemInfoLevels;

//Export a function for creating an emitter
exports.createLoggerFactory = function (appName, writer, ip) { return new LoggerFactory(appName, writer, ip) };

//Create a console writer
exports.createConsoleWriter = createConsoleWriter;
