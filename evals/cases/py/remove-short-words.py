def remove_short_words(words):
    for word in words:
        if len(word) < 3:
            words.remove(word)
    return words
