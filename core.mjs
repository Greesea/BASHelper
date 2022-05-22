import fs from "fs";
import {XMLParser} from "fast-xml-parser";
import {round, toFinite} from "lodash-es";

const Number2Base26 = (value, upperCase = true) => {
    let absValue = Math.floor(Math.abs(value));

    let text = "";
    while (absValue > 0) {
        let remain = absValue % 26 || 26;
        text = String.fromCharCode((upperCase ? 64 : 96) + remain) + text;

        absValue = (absValue - remain) / 26;
    }
    return text;
};
const GenerateID = (function () {
    return Number2Base26(++this.current, false);
}).bind({current: 0});
export const InputInvalid = value => value == null || value === "";
export const Input2ElapsedTime = (text, currentElapsed = 0) => {
    if (text.indexOf(":") > -1)
        return text.split(":").slice(-3).reverse().reduce((sum, item, index) => {
            if (InputInvalid(item))
                return sum;
            return sum + Math.abs(toFinite(parseFloat(item))) * Math.pow(60, index);
        }, 0) * 1000;

    let matchers = [
        [/[0-9.]+(?=h)/gi, 60 * 60 * 1000],
        [/[0-9.]+(?=m[^s])/gi, 60 * 1000],
        [/[0-9.]+(?=s)/gi, 1000],
        [/[0-9.]+(?=ms)/gi, 1],
    ];
    return currentElapsed + matchers.reduce((sum, [regex, unit]) => sum + toFinite(parseFloat(text.match(regex)?.[0])) * unit, 0);
};
const BuildBASItem = info => [
    info.define,
    [info.parallel.join(" "), info.main.join(" then ")].filter(i => i).join(" "),
    info.sub.join("\n"),
].filter(i => i && i !== "").join("\n");

export const Percent = (source, action = 0, precision = 4) => `${round(toFinite(parseFloat(source)) + action, precision)}%`;
export const Duration = (value, unit = "ms") => {
    value = value < 0 ? 0 : value;
    return `${value}${value === 0 ? "s" : unit}`;
};
export const Elapsed = (target, baseline) => target < baseline ? baseline : target;
/**
 * 测量文字尺寸
 * @param {string} text
 * @param {number | string} fontSize
 * @return {{width: number, height: number}}
 */
export const TextMeasure = (text, fontSize) => {
    fontSize = toFinite(parseFloat(fontSize));

    return Array.from(text).reduce((info, char) => {
        info.width += (char.charCodeAt(0) < 1 << 7 ? 1 : 2) * fontSize;
        return info;
    }, {width: 0, height: fontSize * 2});
};
export const ObjectArrayBuilder = objectContent => Object.entries(objectContent).reduce((array, [key, repeatConfig]) => {
    let index = 0;
    repeatConfig.forEach(([value, times]) => {
        for (let i = 0; i < times; i++, index++) {
            if (!array[index])
                array[index] = {};
            array[index][key] = value;
        }
    });
    return array;
}, []);

const EventBusActions = {
    detach: "detach",
};

class BASItem {
    #immediate = true;
    #initialElapsed;
    #eventBus;
    /**
     * @type {BASSequenceItem[]}
     */
    #sequence = [];
    /**
     * @type {BASItem[]}
     */
    #children = [];

    id = GenerateID();
    options;

    constructor(eventBus, options, timestamp) {
        this.#eventBus = eventBus;
        this.options = options ?? {};

        this.delayInitialTimestamp(timestamp ?? ":0", this.options);
    }

    delayInitialTimestamp(timestamp, state) {
        let newInitialElapsed = Input2ElapsedTime(timestamp) + (this.#initialElapsed ?? 0);

        // reset
        if (!this.#immediate) {
            this.#immediate = true;
            this.#initialElapsed = 0;
            this.#sequence.splice(0, 2);
        }

        if (newInitialElapsed > 0) {
            this.#immediate = false;
            this.#initialElapsed = newInitialElapsed;
            this.#sequence.splice(0, 0, ...this.getInitialTimestampAnimate(newInitialElapsed, state));
        }
    }

    getInitialTimestampAnimate() {
        return [];
    }

    animate(options, durationOrTimestamp, timingFunction) {
        this.#sequence.push(new BASAnimate(options, durationOrTimestamp, timingFunction));
        return this;
    }

    parallelAnimate(animateList, durationOrTimestamp) {
        this.#sequence.push(new BASParallelAnimate(animateList, durationOrTimestamp));
        return this;
    }

    effect(effects) {
        this.#sequence.push(new BASEffect(effects));
        return this;
    }

    /**
     * @param {BASItem} item
     */
    replace(item) {
        this.effect([item]);
        return item;
    }

    /**
     * @param {string} durationOrTimestamp
     */
    sleep(durationOrTimestamp) {
        this.animate({}, durationOrTimestamp);
        return this;
    }

    /**
     * @param {BASItem[]} [array]
     */
    children(array = []) {
        array.forEach(i => i.detach());
        this.#children = this.#children.concat(array);
        return this;
    }

    detach() {
        this.#eventBus(this, EventBusActions.detach);
    }

    /**
     * @param {BASItem} basItem
     * @param {number} elapsed
     * @param {object} [state]
     * @param {BASItem} [parent]
     * @param {string} [delayInitialTimestamp]
     * @return {{define: string, main: string[], sub: string[], parallel: [], elapsed: number}}
     */
    getBAS(basItem, elapsed, state, parent, delayInitialTimestamp) {
        let result = {main: [], sub: [], parallel: []};
        state = this.options instanceof BASOptionRelative ? this.options.relative(state) : {...this.options};
        let optionState = {...state};

        if (delayInitialTimestamp != null && delayInitialTimestamp !== "")
            this.delayInitialTimestamp(delayInitialTimestamp, state);

        for (const item of this.#sequence) {
            let itemResult = item.getBAS(this, elapsed, state);

            result.main = result.main.concat(itemResult.main);
            result.sub = result.sub.concat(itemResult.sub);
            result.parallel = result.parallel.concat(itemResult.parallel);
            elapsed = itemResult.elapsed;
            state = itemResult.state;
        }

        result.sub = result.sub.concat(this.#children.map(item => BuildBASItem(item.getBAS(this, 0, null, this))));

        return {
            ...result,
            define: this.getBASDefine(this.#immediate, optionState, parent),
            elapsed,
        };
    }

    getBASDefine(immediate, state, parent) {
        return "";
    }
}

class BASSequenceItem {
    /**
     * @param {BASItem} basItem
     * @param {number} elapsed
     * @param {object} state
     * @return {{main: string[], sub: string[], parallel: [], elapsed: number, state: object}}
     */
    getBAS(basItem, elapsed, state) {
        return {main: [], sub: [], parallel: [], elapsed, state};
    }
}

/**
 * @typedef BASTextOptions
 * @property {number | string | BASOptionRelative} [x]
 * @property {number | string | BASOptionRelative} [y]
 * @property {number | BASOptionRelative} [zIndex]
 * @property {number | BASOptionRelative} [scale]
 * @property {string | BASOptionRelative} [duration]
 * @property {string | BASOptionRelative} content
 * @property {number | BASOptionRelative} [alpha]
 * @property {string | BASOptionRelative} [color]
 * @property {number | BASOptionRelative} [anchorX]
 * @property {number | BASOptionRelative} [anchorY]
 * @property {number | string| BASOptionRelative} [fontSize]
 * @property {string | BASOptionRelative} [fontFamily]
 * @property {boolean | BASOptionRelative} [bold]
 * @property {boolean | BASOptionRelative} [textShadow]
 * @property {number | BASOptionRelative} [strokeWidth]
 * @property {string | BASOptionRelative} [strokeColor]
 * @property {number | BASOptionRelative} [rotateX]
 * @property {number | BASOptionRelative} [rotateY]
 * @property {number | BASOptionRelative} [rotateZ]
 */
/**
 * @typedef BASTextAnimateOptions
 * @property {number | string | [number, string] | [string, string] | BASOptionRelative} [x]
 * @property {number | string | [number, string] | [string, string] | BASOptionRelative} [y]
 * @property {number | [number, string] | BASOptionRelative} [scale]
 * @property {string | BASOptionRelative} [content]
 * @property {number | [number, string] | BASOptionRelative} [alpha]
 * @property {string | [string, string] | BASOptionRelative} [color]
 * @property {number | string | BASOptionRelative} [fontSize]
 * @property {number | [number, string] | BASOptionRelative} [rotateX]
 * @property {number | [number, string] | BASOptionRelative} [rotateY]
 * @property {number | [number, string] | BASOptionRelative} [rotateZ]
 */
class BASText extends BASItem {
    /**
     * @param eventBus
     * @param {BASTextOptions | BASOptionRelative} [options]
     * @param {string} [timestamp]
     */
    constructor(eventBus, options, timestamp) {
        super(eventBus, options, timestamp);
    }

    getInitialTimestampAnimate(newInitialElapsed, state) {
        return [
            new BASAnimate({}, `${newInitialElapsed}ms`),
            new BASAnimate({alpha: (state?.alpha instanceof BASOptionRelative ? state.alpha.relative({options: state}, "alpha") : state?.alpha) ?? 1}),
        ];
    }

    /**
     * 创建动画
     * @param {BASTextAnimateOptions} [options]
     * @param {string} [durationOrTimestamp]
     * @param {string} [timingFunction]
     * @returns {BASText}
     */
    animate(options = {}, durationOrTimestamp, timingFunction) {
        return super.animate(options, durationOrTimestamp, timingFunction);
    }

    /**
     * @return {BASText}
     */
    parallelAnimate(animateList, durationOrTimestamp) {
        return super.parallelAnimate(animateList, durationOrTimestamp);
    }

    /**
     * @return {BASText}
     */
    effect(effects) {
        return super.effect(effects);
    }

    /**
     * @return {BASText}
     */
    sleep(durationOrTimestamp) {
        return super.sleep(durationOrTimestamp);
    }

    /**
     * @return {BASText}
     */
    children(array = []) {
        return super.children(array);
    }

    getBASDefine(immediate, state, parent) {
        return `def text ${this.id}{${
            Object.entries({
                ...state,
                alpha: immediate ? state.alpha : 0,
                parent: parent?.id,
            }).map(([key, value]) => {
                if (value instanceof BASOptionRelative) {
                    value = value.relative(state, key);
                    state[key] = value;
                }

                switch (key) {
                    case "color":
                        return `${key}=0x${(value ?? "").replace("#", "")}`;
                    case "content":
                    case "fontFamily":
                        return `${key}="${value}"`;
                    case "bold":
                    case "textShadow":
                        return `${key}=${value ? 1 : 0}`;
                    default:
                        return value == null ? null : `${key}=${value}`;
                }
            }).filter(i => i).join(" ")
        }}`;
    }
}

/**
 * @typedef BASSvgOptions
 * @property {number | string | BASOptionRelative} [x]
 * @property {number | string | BASOptionRelative} [y]
 * @property {number | BASOptionRelative} [zIndex]
 * @property {number | BASOptionRelative} [scale]
 * @property {string | BASOptionRelative} [duration]
 * @property {string | BASOptionRelative} d
 * @property {number | BASOptionRelative} [borderWidth]
 * @property {string | BASOptionRelative} [borderColor]
 * @property {number | BASOptionRelative} [borderAlpha]
 * @property {string | BASOptionRelative} [fillColor]
 * @property {number | BASOptionRelative} [fillAlpha]
 * @property {string | BASOptionRelative} [viewBox]
 * @property {number | string | BASOptionRelative} [width]
 * @property {number | string | BASOptionRelative} [height]
 */
/**
 * @typedef BASSvgAnimateOptions
 * @property {number | string | [number, string] | [string, string] | BASOptionRelative} [x]
 * @property {number | string | [number, string] | [string, string] | BASOptionRelative} [y]
 */
class BASSvg extends BASItem {
    /**
     * @param eventBus
     * @param {BASSvgOptions | BASOptionRelative} [options]
     */
    constructor(eventBus, options) {
        super(eventBus, options);
    }

    /**
     * 创建动画
     * @param {BASSvgAnimateOptions} [options]
     * @param {string} [durationOrTimestamp]
     * @param {string} [timingFunction]
     * @returns {BASSvg}
     */
    animate(options = {}, durationOrTimestamp, timingFunction) {
        return super.animate(options, durationOrTimestamp, timingFunction);
    }

    /**
     * @return {BASSvg}
     */
    parallelAnimate(animateList, durationOrTimestamp) {
        return super.parallelAnimate(animateList, durationOrTimestamp);
    }

    /**
     * @return {BASSvg}
     */
    effect(effects) {
        return super.effect(effects);
    }

    /**
     * @return {BASSvg}
     */
    sleep(durationOrTimestamp) {
        return super.sleep(durationOrTimestamp);
    }

    /**
     * @return {BASSvg}
     */
    children(array = []) {
        return super.children(array);
    }

    getBASDefine(immediate, state, parent) {
        return `def path ${this.id}{${
            Object.entries({
                ...state,
                parent: parent?.id,
            }).map(([key, value]) => {
                if (value instanceof BASOptionRelative) {
                    value = value.relative(state, key);
                    state[key] = value;
                }

                switch (key) {
                    case "borderColor":
                    case "fillColor":
                        return `${key}=0x${(value ?? "").replace("#", "")}`;
                    case "d":
                    case "viewBox":
                        return `${key}="${value}"`;
                    default:
                        return value == null ? null : `${key}=${value}`;
                }
            }).filter(i => i).join(" ")
        }}`;
    }
}

class BASAnimate extends BASSequenceItem {
    options;
    durationOrTimestamp;
    timingFunction;

    constructor(options, durationOrTimestamp, timingFunction) {
        super();
        this.options = options ?? {};
        this.durationOrTimestamp = durationOrTimestamp ?? ":0";
        this.timingFunction = timingFunction ?? TimingFunction.linear;
    }

    getBAS(basItem, elapsed, state) {
        let mainElapsed = Elapsed(Input2ElapsedTime(this.durationOrTimestamp, elapsed), elapsed);

        return {
            main: [
                `set ${basItem.id} {${
                    Object.entries(this.options).map(([key, value]) => {
                        if (value instanceof BASOptionRelative) {
                            value = value.relative(state, key);
                            this.options[key] = value;
                        }

                        switch (key) {
                            case "color":
                                return `${key}=0x${value}`;
                            case "content":
                                return `${key}="${value}"`;
                            default:
                                return `${key}=${value}`;
                        }
                    }).join(" ")
                }} ${Duration(mainElapsed - elapsed)}${this.timingFunction === TimingFunction.linear ? "" : `,"${this.timingFunction}"`}`
            ],
            sub: [],
            parallel: [],
            elapsed: mainElapsed,
            state: {...state, ...this.options},
        };
    }
}

class BASParallelAnimate extends BASSequenceItem {
    /**
     * @type {BASAnimate[]}
     */
    animateList;
    durationOrTimestamp;

    constructor(animateList, durationOrTimestamp) {
        super();
        this.animateList = animateList;
        this.durationOrTimestamp = durationOrTimestamp ?? ":0";
    }

    getBAS(basItem, elapsed, state) {
        let mainElapsed = Elapsed(Input2ElapsedTime(this.durationOrTimestamp, elapsed), elapsed);
        let parallelItems = this.animateList.map(
            i => {
                let result = [new BASAnimate({}, `${elapsed}ms`), new BASAnimate(i.options, this.durationOrTimestamp, i.timingFunction)]
                    .reduce((result, animateItem) => {
                        let current = animateItem.getBAS(basItem, result.elapsed, result.state);
                        current.main = result.main.concat(current.main);
                        return current;
                    }, {main: [], elapsed: 0, state})
                state = result.state;
                return result.main.join(" then ");
            }
        );

        return {
            main: new BASAnimate({}, this.durationOrTimestamp).getBAS(basItem, elapsed).main,
            sub: [],
            parallel: parallelItems,
            elapsed: this.animateList.length ? mainElapsed : elapsed,
            state,
        }
    }
}

class BASEffect extends BASSequenceItem {
    /**
     * @type {[]}
     */
    effects;

    constructor(effects) {
        super();
        this.effects = effects ?? [];
        this.effects?.forEach(i => i instanceof BASItem && i.detach());
    }

    getBAS(basItem, elapsed, state) {
        let result = {main: [], sub: [], parallel: []};

        this.effects.forEach(item => {
            let itemResult;

            if (item instanceof BASItem) {
                itemResult = item.getBAS(basItem, 0, state, null, `${elapsed}ms`);
                result.sub.push(BuildBASItem(itemResult));
            } else {
                itemResult = item.getBAS(basItem, elapsed, state);
                if (item instanceof BASAnimate)
                    elapsed = itemResult.elapsed;

                result.main = result.main.concat(itemResult.main);
                result.parallel = result.parallel.concat(itemResult.parallel);
                state = itemResult.state;
            }
        });

        return {
            ...result,
            elapsed,
            state,
        };
    }
}

class BASOptionRelative {
    value;

    /**
     * @param {function(value: object): object} [value]
     */
    constructor(value) {
        this.value = value;
    }

    relative(state, optionKey) {
        let value = optionKey ? state?.[optionKey] : state;
        return this.value ? this.value(value) : value;
    }
}

export function relative(value) {
    return new BASOptionRelative(value);
}

export function extend() {
    return new BASOptionRelative();
}

export const TimingFunction = {
    linear: "linear",
    ease: "ease",
    easeIn: "ease-in",
    easeOut: "ease-out",
    easeInOut: "ease-in-out",
};

const SVGFileCache = new Map();

/**
 * @param {string} path
 * @return {{d: string, viewBox: string, width: number, height: number}}
 */
export function LoadSVGFromFile(path) {
    if (SVGFileCache.has(path))
        return SVGFileCache.get(path);

    let xmlObj = new XMLParser({ignoreAttributes: false}).parse(fs.readFileSync(path));
    let width = xmlObj.svg["@_width"];
    let height = xmlObj.svg["@_height"];
    let viewBox = xmlObj.svg["@_viewBox"];
    if ((InputInvalid(width) || InputInvalid(height)) && !InputInvalid(viewBox)) {
        let viewBoxValue = viewBox.replace(",", " ").split(" ").filter(i => i);
        width = viewBoxValue[2];
        height = viewBoxValue[3];
    }
    if (InputInvalid(viewBox) && !InputInvalid(width) && !InputInvalid(height)) {
        viewBox = `0 0 ${width} ${height}`
    }

    SVGFileCache.set(path, {
        d: xmlObj.svg.path["@_d"],
        viewBox,
        width,
        height,
    });
    return SVGFileCache.get(path);
}

const methods = {
    /**
     * @param {BASTextOptions | BASOptionRelative} options
     * @param {string} [timestamp]
     * @returns {BASText}
     */
    text(options, timestamp) {
        this.pool.push(new BASText(this.eventBus, options, timestamp));
        return this.pool[this.pool.length - 1];
    },

    /**
     * @param {BASSvgOptions | BASOptionRelative} options
     * @returns {BASSvg}
     */
    svg(options) {
        this.pool.push(new BASSvg(this.eventBus, options));
        return this.pool[this.pool.length - 1];
    },

    animate(options, durationOrTimestamp, timingFunction) {
        return new BASAnimate(options, durationOrTimestamp, timingFunction);
    },

    parallelAnimate(animateList, durationOrTimestamp) {
        return new BASParallelAnimate(animateList, durationOrTimestamp);
    },

    /**
     * @return {string}
     */
    getBAS() {
        return this.pool.map(i => BuildBASItem(i.getBAS(null, 0))).join("\n");
    },
};
const eventBus = function (item, action) {
    if (!item)
        return;
    switch (action) {
        case EventBusActions.detach:
            this.pool = this.pool.filter(i => i !== item);
            break;
    }
};

export function BAS() {
    const scope = {
        pool: [],
    };
    const obj = {...methods};
    scope.eventBus = eventBus.bind(scope);
    Object.entries(obj).forEach(([key, value]) => {
        obj[key] = value.bind(scope);
    });
    return obj;
}