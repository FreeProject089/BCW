# ZAP hook for the DAST jobs, loaded by zap-baseline.py / zap-full-scan.py with --hook
# (see .github/scripts/dast-scan.sh).
#
# zap-baseline.py writes JSON, HTML and Markdown reports but has no SARIF option. ZAP's own
# report add-on does ("sarif-json" template), so the SARIF uploaded to GitHub code scanning is
# written by ZAP from the same session as zap.json, not converted by us after the fact.
# Runs just before ZAP shuts down, when the passive (and, in full mode, active) scan is over.


def zap_pre_shutdown(zap):
    zap.reports.generate(
        title='BCWEB DAST (ZAP)',
        template='sarif-json',
        reportdir='/zap/wrk',
        reportfilename='zap.sarif.json',
    )
