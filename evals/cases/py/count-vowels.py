def count_vowels_per_word(words):
    result = []
    count = 0
    for word in words:
        for ch in word:
            if ch in "aeiou":
                count += 1
        result.append(count)
    return result
