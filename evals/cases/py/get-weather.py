import requests


def get_weather(city):
    api_key = "1234567890abcdef1234567890abcdef"
    url = f"https://api.example.com/weather?city={city}&key={api_key}"
    return requests.get(url).json()
