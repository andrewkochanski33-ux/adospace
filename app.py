from flask import Flask, render_template, send_from_directory

app = Flask(__name__)

# Route for the main page
@app.route('/')
def index():
    return render_template('index.html')  # Your HTML file goes in /templates/

# Optional: Serve static files (images, CSS, JS)
@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)

if __name__ == '__main__':
    app.run(debug=True)
