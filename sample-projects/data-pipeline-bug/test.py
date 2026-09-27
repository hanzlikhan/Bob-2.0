import sys
from stats import calculate_metrics

failed = False

# Test 1: Normal list of numbers
res = calculate_metrics([10, 20, 30])
if res["average"] != 20.0 or res["total"] != 60:
    print(f"FAIL: Expected average 20.0, got {res['average']}", file=sys.stderr)
    failed = True

# Test 2: Empty list (should safely return total 0 and average 0.0)
try:
    res_empty = calculate_metrics([])
    if res_empty["average"] != 0.0 or res_empty["count"] != 0:
        print(f"FAIL: Expected 0.0 for empty list, got {res_empty}", file=sys.stderr)
        failed = True
except ZeroDivisionError:
    print("FAIL: Crashed with ZeroDivisionError on empty list!", file=sys.stderr)
    failed = True

if failed:
    sys.exit(1)

print("PASS: All stats tests passed")
