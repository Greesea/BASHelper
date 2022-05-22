import {Duration, Input2ElapsedTime, InputInvalid, Percent, relative, TextMeasure, TimingFunction} from "./core.mjs";
import {round, shuffle} from "lodash-es";

export const getToolkits = (basInstance) => {
    const {text, svg, animate, getBAS,} = basInstance;

    //region toolkits
    const words = (content, timestamp, stepConfig, effectConfig, syncEnd) => {
        let elapsed = Input2ElapsedTime(timestamp);
        let elapsedAtLastChar = elapsed;
        content = Array.from(content);
        let configStepByStep = stepConfig instanceof Array;
        let items = Array.from(content).reduce(({items, prev}, char, index) => {
            let config = (configStepByStep ? stepConfig[index] : stepConfig) ?? {};
            let delay = Input2ElapsedTime(config.delay ?? ":0");
            let syncEndDelay = configStepByStep ? (stepConfig.slice(index + 1).reduce((sum, config) => sum + Input2ElapsedTime(config.delay ?? ":0"), 0)) : ((content.length - index - 1) * delay);
            let item;

            if (!prev) {
                item = text({
                    fontSize: "2.2%",
                    ...config.options ?? {},
                    content: char
                }, `${elapsed}ms`);
                items.push({config, delay, syncEndDelay, item,});
                prev = item;
            } else {
                item = text(relative(v => ({
                    ...v,
                    fontSize: InputInvalid(config.options?.fontSize) ? "2.2%" : config.options?.fontSize,
                    content: char,
                    x: Percent(v.x, config?.charSpacing?.x ?? 0),
                    y: Percent(v.y, config?.charSpacing?.y ?? 0),
                    ...(configStepByStep ? config.options : null) ?? {}
                })), `${delay}ms`);
                items.push({config, delay, syncEndDelay, item,});
                prev.effect([item]);
                prev = item;
                elapsedAtLastChar += delay;
            }

            return {items, prev};
        }, {items: [], prev: null}).items;

        effectConfig = {afterSyncEnd: false, ...(effectConfig instanceof Function ? {effect: effectConfig} : effectConfig) ?? {}};
        return {
            items: items.map((itemInfo, index) => {
                let {config, delay, syncEndDelay, item} = itemInfo;
                let itemInfoEffectArgs = {...itemInfo, index};

                if (effectConfig.effect && !effectConfig.afterSyncEnd)
                    item.effect(effectConfig.effect(itemInfoEffectArgs));
                if (syncEnd)
                    item.sleep(`${syncEndDelay}ms`)
                if (effectConfig.effect && effectConfig.afterSyncEnd)
                    item.effect(effectConfig.effect(itemInfoEffectArgs));

                return item;
            }),
            elapsedAtLastChar,
        };
    };
    const danmaku = (contents, timestamp, stepConfig) => {
        contents = contents instanceof Array ? contents : [contents];
        let configStepByStep = stepConfig instanceof Array;

        let elapsed = Input2ElapsedTime(timestamp);
        let rowStatus = [];
        contents.forEach((content, index) => {
            let config = (configStepByStep ? stepConfig[index] : stepConfig) ?? {};
            let delay = index === 0 ? 0 : Input2ElapsedTime(config.delay ?? ":0");
            elapsed += delay;
            let size = TextMeasure(content, config.options?.fontSize ?? 2.2);
            let duration = Input2ElapsedTime(config.duration ?? "10s");
            let rowSlotIndex = rowStatus.findIndex(i => i.speed * (elapsed - i.elapsed) - i.size.width > 0);
            rowSlotIndex = rowSlotIndex === -1 ? rowStatus.length : rowSlotIndex;

            text(
                {
                    content,
                    fontSize: "2.2%",
                    x: "100%",
                    y: Percent(rowSlotIndex * (config.rowSpacing ?? 0) + rowStatus.slice(0, rowSlotIndex).reduce((sum, i) => sum + i.size.height, 0)),
                    ...config.options ?? {},
                },
                `${elapsed}ms`
            )
                .animate({x: Percent(-size.width)}, `${duration}ms`);
            rowStatus[rowSlotIndex] = {
                elapsed,
                size,
                duration,
                speed: (100 + size.width) / duration,
            };
        });
    };
    const splash = (items, itemsPerRow, timestamp, delay, blinkDuration, zoneStartX, zoneStartY, zoneEndX, zoneEndY, itemZoneSafePadding) => {
        let [startX, startY, endX, endY] = [parseFloat(zoneStartX), parseFloat(zoneStartY), parseFloat(zoneEndX), parseFloat(zoneEndY)];
        let [width, height] = [endX - startX, endY - startY];
        let [itemZoneWidth, itemZoneHeight] = [width / itemsPerRow, height / Math.ceil(items.length / itemsPerRow)];
        itemZoneSafePadding = itemZoneSafePadding ?? .2;
        let [itemZoneSafeWidth, itemZoneSafeHeight] = [itemZoneWidth * (1 - itemZoneSafePadding * 2), itemZoneHeight * (1 - itemZoneSafePadding * 2)];
        let [itemZoneSafePaddingWidth, itemZoneSafePaddingHeight] = [itemZoneWidth * itemZoneSafePadding, itemZoneHeight * itemZoneSafePadding];
        timestamp = Input2ElapsedTime(timestamp);
        delay = Input2ElapsedTime(delay);
        let blinkStepDuration = Input2ElapsedTime(blinkDuration) / 2;

        return shuffle(items.map((item, index) => ({item, index}))).map(({item, index}, currentIndex) => {
            let columnIndex = index % itemsPerRow;
            let rowIndex = Math.floor(index / itemsPerRow);

            let [x, y] = [
                startX + (itemZoneWidth * columnIndex) + (itemZoneSafeWidth * Math.random() + itemZoneSafePaddingWidth),
                startY + (itemZoneHeight * rowIndex) + (itemZoneSafeHeight * Math.random() + itemZoneSafePaddingHeight),
            ];
            let targetAlpha = item.alpha ?? 1;

            return text({
                ...item,
                x: Percent(x),
                y: Percent(y),
                alpha: 0,
            }, Duration(round(timestamp + delay * currentIndex, 0)))
                .animate({alpha: targetAlpha ?? 1}, `${blinkStepDuration}ms`)
                .animate({alpha: 0}, `${blinkStepDuration}ms`);
        });
    };
    //endregion

    //region animate and effects
    const presets = {
        textFade: config => {
            config = {alpha: config?.isOut ? 0 : 1, isOut: false, duration: ".5s", delay: null, timingFunction: TimingFunction.linear, ...config ?? {}};
            return () => [
                config.isOut ? (config.delay ? animate({}, config.delay) : null) : animate({alpha: 0}, "0s"),
                animate({alpha: config.alpha}, config.duration, config.timingFunction),
                !config.isOut && config.delay ? animate({}, config.delay) : null,
            ].filter(i => i);
        },
        textSwipe: config => {
            config = {alpha: config?.isOut ? 0 : 1, offset: {}, isOut: false, duration: ".5s", delay: null, timingFunction: TimingFunction.linear, ...config ?? {}};
            return () => [
                config.isOut ? (config.delay ? animate({}, config.delay) : null) : animate({alpha: 0}, "0s"),
                animate({
                    x: relative(v => Percent(v, config.offset?.x ?? 0)),
                    y: relative(v => Percent(v, config.offset?.y ?? 0)),
                    alpha: config.alpha,
                }, config.duration, config.timingFunction),
                !config.isOut && config.delay ? animate({}, config.delay) : null,
            ].filter(i => i);
        },
        textSpin: config => {
            config = {alpha: config?.isOut ? 0 : 1, axis: "z", degree: 20, isOut: false, duration: ".5s", delay: null, timingFunction: TimingFunction.linear, ...config ?? {}};
            return () => [
                config.isOut ? (config.delay ? animate({}, config.delay) : null) : animate({alpha: 0}, "0s"),
                animate({
                    [`rotate${(config.axis ?? "").toUpperCase()}`]: relative(v => (v ?? 0) + config.degree),
                    alpha: config.alpha,
                }, config.duration, config.timingFunction),
                !config.isOut && config.delay ? animate({}, config.delay) : null,
            ].filter(i => i);
        },
        text4WayExplode: config => {
            config = {distance: 3, alpha: 0, duration: ".5s", timingFunction: TimingFunction.linear, ...config ?? {}};
            return () => [
                text(relative(value => ({...value, ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, -config.distance)),
                        y: relative(value => Percent(value, -config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                text(relative(value => ({...value, ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, -config.distance)),
                        y: relative(value => Percent(value, config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                text(relative(value => ({...value, ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, config.distance)),
                        y: relative(value => Percent(value, -config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                text(relative(value => ({...value, ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, config.distance)),
                        y: relative(value => Percent(value, config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
            ];
        },
        text4WayExplodeIn: config => {
            config = {distance: 3, alpha: 1, duration: ".5s", timingFunction: TimingFunction.linear, ...config ?? {}};
            return () => [
                animate({alpha: 0}, "0s"),
                text(relative(value => ({...value, alpha: 0, x: Percent(value.x, config.distance), y: Percent(value.y, config.distance), ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, -config.distance)),
                        y: relative(value => Percent(value, -config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                text(relative(value => ({...value, alpha: 0, x: Percent(value.x, config.distance), y: Percent(value.y, -config.distance), ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, -config.distance)),
                        y: relative(value => Percent(value, config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                text(relative(value => ({...value, alpha: 0, x: Percent(value.x, -config.distance), y: Percent(value.y, config.distance), ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, config.distance)),
                        y: relative(value => Percent(value, -config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                text(relative(value => ({...value, alpha: 0, x: Percent(value.x, -config.distance), y: Percent(value.y, -config.distance), ...config?.relative?.(value) ?? {}})))
                    .animate({
                        x: relative(value => Percent(value, config.distance)),
                        y: relative(value => Percent(value, config.distance)),
                        alpha: config.alpha,
                    }, config.duration, config.timingFunction),
                animate({}, config.duration),
                animate({alpha: config.alpha}, "0s"),
            ];
        },
        textCrossX: {
            inAnimateCharSpacingHelper: (wordsLength, charSpacingX = 2) => {
                let groupNums = Math.ceil(wordsLength / 2);
                let array = [];
                charSpacingX *= 2;

                for (let i = 0; i < groupNums; i++) {
                    array.splice(array.length, 0, [{x: charSpacingX, y: 0}, 1], [{x: 0, y: 0}, 1]);
                }

                return array;
            },

            inAnimate: (animateConfig) => {
                // 基于 1 2 叠加，入时，第一个必定向左
                animateConfig = {charSpacingX: 2, delay: null, duration: ".5s", timingFunction: TimingFunction.ease, ...animateConfig ?? {}};
                animateConfig.charSpacingX = animateConfig.charSpacingX / 2;
                return ({index}) => [
                    animate({alpha: 0}, "0s"),
                    animate({x: relative(v => Percent(v, index % 2 === 0 ? -animateConfig.charSpacingX : animateConfig.charSpacingX)), alpha: 1}, animateConfig.duration, animateConfig.timingFunction),
                    animateConfig.delay ? animate({}, animateConfig.delay) : null,
                ].filter(i => i);
            },
            outAnimate: (animateConfig) => {
                // 基于 1 2 叠加，出时，第一个必定向右
                animateConfig = {charSpacingX: 2, delay: null, duration: ".5s", timingFunction: TimingFunction.ease, ...animateConfig ?? {}};
                animateConfig.charSpacingX = animateConfig.charSpacingX / 2;
                return ({index}) => [
                    animateConfig.delay ? animate({}, animateConfig.delay) : null,
                    animate({x: relative(v => Percent(v, index % 2 === 0 ? animateConfig.charSpacingX : -animateConfig.charSpacingX)), alpha: 0}, animateConfig.duration, animateConfig.timingFunction),
                ].filter(i => i);
            },
        },
        textCrossY: {
            inAnimateCharSpacingHelper: (wordsLength, charSpacingX, charSpacingY = 2, firstCharDown2Up) => {
                let groupNums = Math.ceil(wordsLength / 2);
                let array = [];
                charSpacingY *= 2;

                if (firstCharDown2Up)
                    charSpacingY = -charSpacingY;

                for (let i = 0; i < groupNums; i++) {
                    array.splice(array.length, 0, [{x: charSpacingX, y: -charSpacingY}, 1], [{x: charSpacingX, y: charSpacingY}, 1]);
                }

                return array;
            },

            inAnimate: (animateConfig) => {
                animateConfig = {charSpacingY: 2, delay: null, duration: ".5s", timingFunction: TimingFunction.ease, firstCharDown2Up: false, ...animateConfig ?? {}};
                return ({index}) => [
                    animate({alpha: 0}, "0s"),
                    animate({
                        y: relative(
                            v => Percent(
                                v,
                                index % 2 === 0 ?
                                    (animateConfig.firstCharDown2Up ? -animateConfig.charSpacingY : animateConfig.charSpacingY) :
                                    (animateConfig.firstCharDown2Up ? animateConfig.charSpacingY : -animateConfig.charSpacingY)
                            ),
                        ),
                        alpha: 1,
                    }, animateConfig.duration, animateConfig.timingFunction),
                    animateConfig.delay ? animate({}, animateConfig.delay) : null,
                ].filter(i => i);
            },
            outAnimate: (animateConfig) => {
                animateConfig = {charSpacingY: 2, delay: null, duration: ".5s", timingFunction: TimingFunction.ease, firstCharDown2Up: false, ...animateConfig ?? {}};
                return ({index}) => [
                    animateConfig.delay ? animate({}, animateConfig.delay) : null,
                    animate({
                        y: relative(
                            v => Percent(
                                v,
                                index % 2 === 0 ?
                                    (animateConfig.firstCharDown2Up ? -animateConfig.charSpacingY : animateConfig.charSpacingY) :
                                    (animateConfig.firstCharDown2Up ? animateConfig.charSpacingY : -animateConfig.charSpacingY)
                            ),
                        ),
                        alpha: 0,
                    }, animateConfig.duration, animateConfig.timingFunction),
                ].filter(i => i);
            },
        }
    };
    //endregion

    return {words, danmaku, splash, presets};
}