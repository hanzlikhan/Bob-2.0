def calculate_metrics(numbers):
    """
    Calculates sum, average, and min/max metrics for a list of numbers.
    """
    if not numbers:
        return {
            "count": 0,
            "total": 0,
            "average": 0.0,
        }
    total = sum(numbers)
    avg = total / len(numbers)
    return {
        "count": len(numbers),
        "total": total,
        "average": float(avg),
    }
