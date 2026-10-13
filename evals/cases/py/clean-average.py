def average(scores):
    if not scores:
        return 0
    return sum(scores) / len(scores)
