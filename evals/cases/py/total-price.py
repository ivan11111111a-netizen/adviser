def total_price(items):
    total = 0
    for item in items:
        print("DEBUG", item)
        total += item["price"]
    return total
