-- China officially uses Beijing time everywhere, including Xinjiang. tz-lookup tags
-- far-western Chinese airports as Asia/Urumqi (UTC+6), but flights there are scheduled
-- and logged in Beijing time (UTC+8). Normalize Chinese airports to Asia/Shanghai so the
-- UI shows times/dates matching boarding passes. (The ourairports import does the same on
-- refresh; this fixes rows already loaded.) Mongolian airports tz-lookup also tags
-- Asia/Urumqi are left alone — Mongolia is not on Beijing time.
update public.airports set timezone = 'Asia/Shanghai'
where timezone = 'Asia/Urumqi' and country = 'CN';
