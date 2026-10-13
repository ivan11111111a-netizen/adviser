def read_numbers(path):
    f = open(path)
    numbers = []
    for line in f:
        numbers.append(int(line))
    return numbers
