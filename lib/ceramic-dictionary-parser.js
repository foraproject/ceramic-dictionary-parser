(function() {

    "use strict";

    /*
        DictParser Service
        Parses a flat dictionary type structure to a complex entity.
        Nested entities must be separated by underscores (which can be overridden in options.delimiter).
    */
    var sanitizer = require('sanitizer');


    var isPrimitiveType = function(type) {
        return ['string', 'number', 'integer', 'boolean', 'array'].indexOf(type) > -1;
    };


    var isCustomType = function(type) {
        return !isPrimitiveType(type);
    };


    var DictParser = function(dict, ceramic, options) {
        this.dict = dict;
        this.ceramic = ceramic;

        options = options || {};
        options.delimiter = options.delimiter || "_";
        this.options = options;

        var self = this;
        this.getter = options.getter || function*(name) { return self.dict[name]; };
    };



    DictParser.prototype.getField = function*(name, def) {
        def = def || { type: "string" };

        if (typeof(def) === "string")
            def = { type: def };

        var value = yield* this.getter(name);

        if (value)
            return this.parseSimpleType(value, name, def);
    };



    DictParser.prototype.map = function*(target, entitySchema, whitelist, options, parents) {
        options = options || { overwrite: true };
        parents = parents || [];

        whitelist = whitelist.map(function(e) {
            return e.split(this.options.delimiter);
        });

        return yield this.map_impl(target, entitySchema, whitelist, options, parents);

    };


    DictParser.prototype.map_impl = function*(target, entitySchema, whitelist, options, parents) {
        var changed = false;

        for (var fieldName in entitySchema.schema.properties) {
            var def = entitySchema.schema.properties[fieldName];
            var fieldWhiteList = whitelist.filter(function(e) { return e[0] === fieldName; });

            if (yield this.setField(target, fieldName, def, entitySchema, fieldWhiteList, options, parents))
                changed = true;
        }
        return changed;
    };


    DictParser.prototype.setField = function*(obj, fieldName, def, entitySchema, whitelist, options, parents) {
        if (isPrimitiveType(def.type)) {
            if (def.type !== 'array') {
                if (whitelist[0] && whitelist[0][0] === fieldName)
                    return yield this.setSimpleType(obj, fieldName, def, entitySchema, whitelist, options, parents);
            } else {
                return yield this.setArray(obj, fieldName, def, entitySchema, whitelist, options, parents);
            }
        } else {
            return yield this.setCustomType(obj, fieldName, def, entitySchema, whitelist, options, parents);
        }
    };


    //eg: name: "jeswin", age: 33
    DictParser.prototype.setSimpleType = function*(obj, fieldName, def, entitySchema, whitelist, options, parents) {
        var changed = false;
        var formField = parents.concat(fieldName).join(this.options.delimiter);
        var val = yield this.getField(formField);
        if (val) {
            var result = this.parseSimpleType(val, fieldName, def, entitySchema);
            if(!(obj instanceof Array)) {
                if (options.overwrite)
                    obj[fieldName] = result;
                else
                    obj[fieldName] = obj[fieldName] || result;
                changed = true;
            } else {
                obj.push(result);
                changed = true;
            }
        }
        return changed;
    };


    /*
        Two possibilities
        #1. Array of primitives (eg: customerids_1: 13, customerids_2: 44, or as CSV like customerids: "1,54,66,224")
        #2. Array of objects (eg: customers_1_name: "jeswin", customers_1_age: "33")
    */
    DictParser.prototype.setArray = function*(obj, fieldName, def, entitySchema, whitelist, options, parents) {
        var changed = false;
        if (entitySchema && entitySchema.mapping && entitySchema.mapping[fieldName]) {
            if (def.items.type !== 'array') {
                if (whitelist.indexOf(fieldName) !== -1) {
                    var formField = parents.concat(fieldName).join('_');
                    var val = yield this.getField(formField);
                    var items = val.split(',');
                    items.forEach(function(i) {
                        obj[fieldName].push(this.parseSimpleType(val, fieldName + "[]", def.items, def));
                        changed = true;
                    });
                }
            }
            else
                throw new Error("Cannot map array of arrays");
        } else {
            parents.push(fieldName);

            var counter = 1;
            var newArray = obj[fieldName] || [];

            while(true) {
                if (yield this.setField(newArray, counter, def.items, def, whitelist, options, parents)) {
                    counter++;
                    obj[fieldName] = obj[fieldName] || newArray;
                    changed = true;
                } else {
                    break;
                }
            }

            parents.pop();
        }

        return changed;
    };


    DictParser.prototype.setCustomType = function*(obj, fieldName, def, entitySchema, whitelist, options, parents) {
        var changed = false;

        whitelist = whitelist.map(function(a) { return a.slice(1); });
        parents.push(fieldName);
        if (def.entitySchema && def.entitySchema.ctor) {
            var newObj = def.entitySchema.ctor ? (new def.entitySchema.ctor()) : {};
            changed = yield this.map_impl(newObj, def.entitySchema, whitelist, options, parents);
            if (changed) {
                if (!(obj instanceof Array))
                    obj[fieldName] = newObj;
                else
                    obj.push(newObj);
            }
        }
        parents.pop();

        return changed;
    };


    DictParser.prototype.parseSimpleType = function(val, fieldName, def, entitySchema) {
        if (val) {
            switch(def.type) {
                case "integer":
                    return parseInt(val);
                case "number":
                    return parseFloat(val);
                case "string":
                    return (entitySchema && entitySchema.htmlFields && entitySchema.htmlFields.indexOf(fieldName) !== -1) ?
                        sanitizer.sanitize(sanitizer.unescapeEntities(val)) : sanitizer.escape(val);
                case "boolean":
                    return val === true || val === "true";
                default:
                    throw new Error(def.type + " " + fieldName + " is not a primitive type or is an array. Cannot parse.");
            }
        }
    };

    module.exports = DictParser;

})();
