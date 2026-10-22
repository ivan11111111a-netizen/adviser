# Eval упражнений: 20261022-2132-exercise-claude-code-sonnet-exercise.v1

22.10.2026, 21:33:56, модель sonnet, промпт exercise.v1, разбирает mentor.v3.

| Метрика | Значение |
|---|---|
| Ошибка нужного типа нашлась | 16 из 16 |
| Есть другие ошибки (не suggestion) | 2 из 16 |
| Не получилось | 0 |

## reference-equality, c

**Условие.** Функция получает расписание тренировок: массив названий дней недели (каждое название — строка не длиннее 9 символов), количество записей в нём и название дня. Верни, сколько раз этот день встречается в расписании.

```c
int count_workouts(char schedule[][10], int n, const char *day) {
    int count = 0;
    for (int i = 0; i < n; i++) {
        if (schedule[i] == day) {
            count++;
        }
    }
    return count;
}
```

Наставник: reference-equality (critical).

## sizeof-pointer, c

**Условие.** Функция получает массив с температурой воздуха за каждый день недели (ровно 7 значений) и возвращает, сколько дней было тёплых, то есть с температурой строго выше 20 градусов.

```c
int count_warm_days(int temps[]) {
    int days = sizeof(temps) / sizeof(temps[0]);
    int warm = 0;

    for (int i = 0; i < days; i++) {
        if (temps[i] > 20) {
            warm++;
        }
    }

    return warm;
}
```

Наставник: sizeof-pointer (critical).

## uninitialized-variable, c

**Условие.** Функция получает массив цен покупок, их количество n и лимит limit. Верни сумму всех цен, которые не превышают limit. Если таких цен нет, верни 0.

```c
int sum_affordable(const int prices[], int n, int limit) {
    int total;
    int count = 0;
    for (int i = 0; i < n; i++) {
        if (prices[i] <= limit) {
            total += prices[i];
            count++;
        }
    }
    if (count == 0) {
        return 0;
    }
    return total;
}
```

Наставник: uninitialized-variable (critical).

## integer-division, java

**Условие.** Напиши функцию, которая принимает массив оценок за четверть (целые числа от 2 до 5) и возвращает средний балл как дробное число, например для оценок 5 и 4 это 4.5. Если оценок нет, функция возвращает 0.

```java
public class Grades {
    public static double averageGrade(int[] grades) {
        if (grades.length == 0) {
            return 0;
        }
        int sum = 0;
        for (int i = 0; i < grades.length; i++) {
            sum += grades[i];
        }
        double average = sum / grades.length;
        return average;
    }
}
```

Наставник: integer-division (critical).

## missing-break, java

**Условие.** Функция получает тип билета в кинотеатре ('C' — детский, 'S' — студенческий, 'A' — взрослый) и количество билетов. Она возвращает общую стоимость: детский билет стоит 150, студенческий — 200, взрослый — 300. Для неизвестного типа билета результат равен 0.

```java
public class Cinema {
    public static int totalPrice(char type, int count) {
        int price = 0;
        switch (type) {
            case 'C':
                price = 150;
                break;
            case 'S':
                price = 200;
            case 'A':
                price = 300;
                break;
        }
        return price * count;
    }
}
```

Наставник: missing-break (critical), missing-input-validation (suggestion).

## scanner-leftover-newline, java

**Условие.** Метод спрашивает у пользователя, сколько товаров он купил, затем — название магазина (оно может состоять из нескольких слов) и возвращает строку вида «Магазин: Большая Лента, товаров: 3».

```java
public class Receipt {
    public static String readReceipt() {
        java.util.Scanner in = new java.util.Scanner(System.in);

        System.out.println("Сколько товаров ты купил?");
        int count = in.nextInt();

        System.out.println("В каком магазине?");
        String shop = in.nextLine();

        return "Магазин: " + shop + ", товаров: " + count;
    }
}
```

Наставник: scanner-leftover-newline (critical), missing-error-handling (warning).

## empty-collection, javascript

**Условие.** Функция принимает строку с названием фильма и делает каждое слово в ней с заглавной буквы, остальные буквы слов не меняет. Слова разделены одним пробелом, например "тайна третьей планеты" превращается в "Тайна Третьей Планеты".

```javascript
function capitalizeTitle(title) {
  const words = title.split(" ");
  const result = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const first = word[0].toUpperCase();
    result.push(first + word.slice(1));
  }
  return result.join(" ");
}
```

Наставник: empty-collection (warning).

## loose-equality, javascript

**Условие.** В списке grades лежат оценки за контрольные: числа от 0 до 5, а если контрольную ученик пропустил, вместо оценки стоит пустая строка "". Верни, сколько раз в списке встречается именно оценка 0 (пропуски не считаются).

```javascript
function countZeroGrades(grades) {
  let count = 0;
  for (let i = 0; i < grades.length; i++) {
    if (grades[i] == 0) {
      count++;
    }
  }
  return count;
}
```

Наставник: loose-equality (suggestion).

## off-by-one, javascript

**Условие.** Функция получает список оценок за четверть в порядке получения. Верни, сколько раз оценка оказалась выше предыдущей.

```javascript
function countImprovements(grades) {
  let count = 0;
  for (let i = 1; i < grades.length - 1; i++) {
    if (grades[i] > grades[i - 1]) {
      count++;
    }
  }
  return count;
}
```

Наставник: off-by-one (warning).

## premature-return, javascript

**Условие.** Функция получает список оценок ученика и возвращает true, если все оценки не ниже 3, и false, если есть хотя бы одна оценка ниже 3. Для пустого списка она возвращает true.

```javascript
function allPassed(grades) {
  for (let i = 0; i < grades.length; i++) {
    if (grades[i] < 3) {
      return false;
    } else {
      return true;
    }
  }
  return true;
}
```

Наставник: premature-return (critical).

## reduce-without-initial, javascript

**Условие.** Функция получает список покупок — объектов вида {name, price, count} — и возвращает общую стоимость всех покупок (цена каждой, умноженная на количество). Если список пустой, вернуть 0.

```javascript
function totalCost(purchases) {
  const total = purchases.reduce((sum, purchase) => {
    const cost = purchase.price * purchase.count;
    return sum + cost;
  });
  return total;
}

// Пример вызова:
// totalCost([{ name: "хлеб", price: 50, count: 2 }, { name: "молоко", price: 80, count: 1 }]);
```

Наставник: reduce-without-initial (critical).

## sort-without-comparator, javascript

**Условие.** Функция получает список очков, набранных игроками в игре, и возвращает три лучших результата в порядке от большего к меньшему. Если результатов меньше трёх, верни все, что есть. Исходный список менять нельзя.

```javascript
function topThreeScores(scores) {
  const sorted = scores.slice();
  sorted.sort();
  sorted.reverse();
  const result = [];
  for (let i = 0; i < sorted.length && i < 3; i++) {
    result.push(sorted[i]);
  }
  return result;
}
```

Наставник: sort-without-comparator (critical).

## integer-division, python

**Условие.** Функция получает список оценок за четверть и возвращает средний балл, округлённый до двух знаков после запятой. Если список пустой, функция возвращает 0.

```python
def average_grade(grades):
    if len(grades) == 0:
        return 0
    total = 0
    for grade in grades:
        total += grade
    average = total // len(grades)
    return round(average, 2)
```

Наставник: integer-division (critical).

## missing-return, python

**Условие.** Функция получает сумму покупки в рублях и возвращает размер скидки в процентах: 0 — если сумма меньше 1000, 5 — если от 1000 до 4999 включительно, 10 — если 5000 и больше.

```python
def get_discount(total):
    if total < 1000:
        return 0
    elif total < 5000:
        percent = 5
    else:
        return 10
```

Наставник: missing-return (critical).

## modify-while-iterating, python

**Условие.** Функция получает список оценок ученика и возвращает список без двоек (оценок, равных 2). Порядок остальных оценок должен сохраниться.

```python
def drop_twos(grades):
    for grade in grades:
        if grade == 2:
            grades.remove(grade)
    return grades
```

Наставник: modify-while-iterating (critical), mutating-input (warning).

## mutable-default-argument, python

**Условие.** Напиши функцию, которая добавляет товар в корзину (список названий) и возвращает корзину. Название нужно очистить от пробелов по краям и привести к нижнему регистру; если такой товар в корзине уже есть, второй раз его не добавляй. Если корзину не передали, функция должна начать с новой пустой корзины.

```python
def add_to_cart(item, cart=[]):
    name = item.strip().lower()
    if name == "":
        return cart
    if name not in cart:
        cart.append(name)
    return cart
```

Наставник: mutable-default-argument (critical).
