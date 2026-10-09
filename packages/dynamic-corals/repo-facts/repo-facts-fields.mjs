// REEF with Repo Facts — the shape of the six fields, in ONE place.
//
// The edge worker builds its answer out of fields that pass these checks; the browser checks the
// answer it receives against the same ones. They used to be two hand-written copies, and they had
// already drifted on their first day: the worker passed `2026-02-30` as a date, the browser refused
// it, and a browser that refuses a field writes nothing for that repo. Two validators that
// disagree are a blank card with a cached cause. So both halves import this file, and neither
// keeps a regex of its own for any of the six.
export const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

const text = (re) => (v) => typeof v === 'string' && re.test(v);
// A calendar date, exactly: it must survive a round trip through Date, so `2026-02-30` and
// anything that is not `YYYY-MM-DD` are both out.
const day = (v) => typeof v === 'string' && new Date(v).toJSON()?.slice(0, 10) === v;

export const FIELDS = {
  tag: text(/^(?=.{1,40}$)v?\d+(\.\d+){1,3}([-.+][0-9A-Za-z.-]+)?$/),
  releasedAt: day,
  pushedAt: day,
  license: text(/^[A-Za-z0-9.+-]{1,40}$/),
  archived: (v) => typeof v === 'boolean',
  fullName: text(REPO),
};
