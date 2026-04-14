/**
 * SM-2 间隔复习算法
 */

/**
 * 答对后更新间隔
 * @param {object} item - 错题本条目
 * @param {'easy'|'good'|'hard'} quality - 回答质量
 */
export function sm2Success(item, quality) {
    var now = Date.now();
    var ease = Number(item.sm2Ease || 2.5);
    var reps = Number(item.sm2Repetitions || 0);
    var interval = Number(item.sm2IntervalDays || 0);

    reps += 1;

    if (quality === 'easy') {
        ease = Math.min(3.0, ease + 0.15);
    } else if (quality === 'good') {
        ease = Math.min(3.0, ease + 0.05);
    } else if (quality === 'hard') {
        ease = Math.max(1.3, ease - 0.15);
    }

    if (reps === 1) {
        interval = 1;
    } else if (reps === 2) {
        interval = 6;
    } else {
        interval = Math.round(interval * ease);
    }

    interval = Math.min(365, Math.max(1, interval));

    item.sm2Ease = ease;
    item.sm2Repetitions = reps;
    item.sm2IntervalDays = interval;
    item.dueAt = now + interval * 24 * 60 * 60 * 1000;
    item.lastReviewAt = now;
    item.masteryScore = Math.min(100, reps * 20);
}

/**
 * 答错后重置间隔
 * @param {object} item - 错题本条目
 */
export function sm2Fail(item) {
    var now = Date.now();
    var ease = Number(item.sm2Ease || 2.5);
    ease = Math.max(1.3, ease - 0.2);

    item.sm2Ease = ease;
    item.sm2Repetitions = 0;
    item.sm2IntervalDays = 0;
    item.dueAt = now + 10 * 60 * 1000;
    item.lastReviewAt = now;
    item.masteryScore = 0;
}
