"""One-time CGV connection check. Python 3; no extra packages or cookies."""

import argparse
import datetime as dt
import json
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(path, params):
    url = "https://cgv.co.kr/api/v1/booking/" + path + "?"
    url += urllib.parse.urlencode({"coCd": "A420", "siteNo": "0113", **params})
    request = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "Referer": "https://cgv.co.kr/cnm/movieBook/ticket",
    })
    result = {"endpoint": path, "httpStatus": None, "ok": False}
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            result["httpStatus"] = response.status
            # No response headers, cookies or raw error pages are printed.
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                return {**result, "error": "response_too_large"}, []
            body = json.loads(raw)
        if not isinstance(body, dict) or body.get("statusCode") != 0 or not isinstance(body.get("data"), list):
            return {**result, "error": "unexpected_response_format"}, []
        return {**result, "ok": True, "rowCount": len(body["data"])}, body["data"]
    except urllib.error.HTTPError as error:
        return {**result, "httpStatus": error.code, "error": "http_error"}, []
    except (ValueError, UnicodeError):
        return {**result, "error": "not_json"}, []
    except (urllib.error.URLError, OSError):
        return {**result, "error": "connection_failed_or_timed_out"}, []


def date_argument(value):
    try:
        if len(value) != 8 or not value.isascii() or not value.isdigit():
            raise ValueError()
        dt.datetime.strptime(value, "%Y%m%d")
        return value
    except ValueError:
        raise argparse.ArgumentTypeError("YYYYMMDD 형식의 날짜를 입력해 주세요.") from None


def main():
    parser = argparse.ArgumentParser(description="CGV 의정부 공개 조회를 두 번만 확인합니다.")
    parser.add_argument("--date", type=date_argument, help="조회할 날짜. 생략하면 조회 가능한 날짜 중 가장 이른 날짜")
    args = parser.parse_args()
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=9)))
    today = now.strftime("%Y%m%d")
    date_result, rows = check("searchSiteScnscYmdListBySite", {})
    dates = []
    for row in rows:
        try:
            date = date_argument(str(row.get("scnYmd", "")))
            if date >= today:
                dates.append(date)
        except (AttributeError, argparse.ArgumentTypeError):
            continue
    date = args.date or min(dates, default=today)
    show_result, _ = check("searchMovScnInfo", {"scnYmd": date, "rtctlScopCd": "08"})
    report = {"checkedAt": now.isoformat(), "date": date, "results": [date_result, show_result]}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    # A successful check confirms access only, not unattended polling or push delivery.
    return 0 if date_result["ok"] and show_result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
