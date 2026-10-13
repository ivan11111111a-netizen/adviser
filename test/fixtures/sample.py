# Учебные функции с типовыми ошибками — для ручных прогонов Adviser.


def read_numbers(path):
    f = open(path)
    numbers = []
    for line in f:
        numbers.append(int(line))
    return numbers


def append_item(item, items=[]):
    items.append(item)
    return items


def safe_divide(a, b):
    try:
        return a / b
    except:
        pass
